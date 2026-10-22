import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import type { UserDirectory } from "./clerk.ts";
import { type Db, getDb } from "./db/client.ts";
import { invites, members } from "./db/schema.ts";
import { createOrgForUser, findOrgForUser } from "./orgs.ts";
import { INVITE_DAYS, acceptInvite, createInvite, hashToken } from "./team.ts";
import { createTestD1 } from "./test/d1.ts";

let db: Db;
let env: Env;
let dispose: () => Promise<void>;
let directoryCalls: string[][];
let directoryFails = false;

const people: Record<string, { name: string | null; email: string | null; imageUrl: string | null }> = {
	team_ada: { name: "Ada Lovelace", email: "ada@example.com", imageUrl: "https://img.example/ada.png" },
	team_ben: { name: null, email: "ben@example.com", imageUrl: null },
	team_cy: { name: null, email: null, imageUrl: null },
};
const directory: UserDirectory = async (_env, ids) => {
	directoryCalls.push(ids);
	if (directoryFails) throw new Error("Clerk is down");
	return new Map(ids.filter((id) => people[id]).map((id) => [id, people[id]]));
};
const verify: SessionVerifier = async (token) => ({ userId: token.slice(2) });
const app = createApp({ verifySession: verify, directory });

let counter = 0;
// A company whose users are `<prefix>_admin`, `<prefix>_member`.
async function newOrg() {
	counter += 1;
	const prefix = `team${counter}`;
	const { org } = await createOrgForUser(db, `${prefix}_admin`, `Team ${counter}`);
	await db.insert(members).values({ orgId: org.id, userId: `${prefix}_member`, role: "member", createdAt: new Date(Date.now() + 1000) });
	return { orgId: org.id, name: `Team ${counter}`, admin: `${prefix}_admin`, member: `${prefix}_member`, prefix };
}

async function call(user: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	return app.request(
		path,
		{
			method,
			headers: { ...(user ? { authorization: `Bearer t:${user}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		env,
	);
}

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = { CLERK_SECRET_KEY: "x", DB: testD1.d1 } as unknown as Env;
	db = getDb(testD1.d1);
	directoryCalls = [];
});
afterAll(() => dispose());

describe("GET /team", () => {
	it("lists admins first with names from Clerk in one batched call", async () => {
		const { orgId, admin, member } = await newOrg();
		await db.insert(members).values({ orgId, userId: "team_ada", role: "admin", createdAt: new Date(Date.now() + 2000) });
		await db.insert(members).values({ orgId, userId: "team_ben", role: "member", createdAt: new Date(Date.now() + 3000) });
		directoryCalls = [];

		const res = await call(member, "GET", "/team");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const { members: list } = (await res.json()) as { members: Record<string, unknown>[] };
		expect(list.map((m) => m.userId)).toEqual([admin, "team_ada", member, "team_ben"]);
		expect(list[1]).toMatchObject({ role: "admin", name: "Ada Lovelace", email: "ada@example.com", imageUrl: "https://img.example/ada.png", isYou: false });
		expect(list[2]).toMatchObject({ role: "member", isYou: true, name: null, email: null });
		expect(list[3]).toMatchObject({ name: null, email: "ben@example.com" });
		expect(typeof list[0].joinedAt).toBe("string");
		expect(directoryCalls).toHaveLength(1);
		expect(directoryCalls[0]).toHaveLength(4);
	});

	it("still lists the people when Clerk is unreachable", async () => {
		const { member } = await newOrg();
		directoryFails = true;
		try {
			const res = await call(member, "GET", "/team");
			expect(res.status).toBe(200);
			const { members: list } = (await res.json()) as { members: { name: string | null }[] };
			expect(list).toHaveLength(2);
			expect(list.every((m) => m.name === null)).toBe(true);
		} finally {
			directoryFails = false;
		}
	});

	it("shows only the caller's own company, and needs a company", async () => {
		const first = await newOrg();
		const second = await newOrg();
		const { members: list } = (await (await call(first.admin, "GET", "/team")).json()) as { members: { userId: string }[] };
		expect(list.map((m) => m.userId)).not.toContain(second.admin);
		expect((await call(null, "GET", "/team")).status).toBe(401);
		expect((await call("stranger", "GET", "/team")).status).toBe(403);
	});
});

describe("PATCH /team/:userId", () => {
	it("lets an admin promote a member, and demote another admin", async () => {
		const { admin, member } = await newOrg();
		const promoted = await call(admin, "PATCH", `/team/${member}`, { role: "admin" });
		expect(promoted.status).toBe(200);
		expect(await promoted.json()).toEqual({ member: { userId: member, role: "admin" } });

		const demoted = await call(member, "PATCH", `/team/${admin}`, { role: "member" });
		expect(demoted.status).toBe(200);
		expect((await findOrgForUser(db, admin))?.role).toBe("member");
	});

	it("treats the same role as a no-op", async () => {
		const { admin, member } = await newOrg();
		expect((await call(admin, "PATCH", `/team/${member}`, { role: "member" })).status).toBe(200);
		expect((await call(admin, "PATCH", `/team/${admin}`, { role: "admin" })).status).toBe(200);
		expect((await findOrgForUser(db, admin))?.role).toBe("admin");
	});

	it("will not demote the last admin, with the message", async () => {
		const { admin } = await newOrg();
		const res = await call(admin, "PATCH", `/team/${admin}`, { role: "member" });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: { code: "last_admin", message: "This is the only admin. Promote someone else before changing this role." },
		});
		expect((await findOrgForUser(db, admin))?.role).toBe("admin");
	});

	it("never leaves a company without an admin when two admins demote each other at once", async () => {
		const { admin, member } = await newOrg();
		await call(admin, "PATCH", `/team/${member}`, { role: "admin" });
		const [a, b] = await Promise.all([
			call(admin, "PATCH", `/team/${member}`, { role: "member" }),
			call(member, "PATCH", `/team/${admin}`, { role: "member" }),
		]);
		expect([a.status, b.status].sort()).toEqual([200, 409]);
		const roles = [(await findOrgForUser(db, admin))?.role, (await findOrgForUser(db, member))?.role];
		expect(roles.filter((role) => role === "admin")).toHaveLength(1);
	});

	it("is for admins only", async () => {
		const { admin, member } = await newOrg();
		const res = await call(member, "PATCH", `/team/${admin}`, { role: "member" });
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
		expect((await call(member, "PATCH", `/team/${member}`, { role: "admin" })).status).toBe(403);
	});

	it("answers 404 for a member of another company or a missing one, and changes nothing", async () => {
		const mine = await newOrg();
		const other = await newOrg();
		expect((await call(mine.admin, "PATCH", `/team/${other.member}`, { role: "admin" })).status).toBe(404);
		expect((await call(mine.admin, "PATCH", "/team/nobody", { role: "admin" })).status).toBe(404);
		expect((await findOrgForUser(db, other.member))?.role).toBe("member");
	});

	it("rejects a role that does not exist", async () => {
		const { admin, member } = await newOrg();
		expect((await call(admin, "PATCH", `/team/${member}`, { role: "owner" })).status).toBe(400);
	});
});

describe("invites", () => {
	async function inviteToken(admin: string) {
		const res = await call(admin, "POST", "/team/invites");
		const { url, expiresAt } = (await res.json()) as { url: string; expiresAt: string };
		return { token: url.split("/invite/")[1], url, expiresAt, status: res.status };
	}

	it("lets an admin create a link that expires in 7 days and is stored only as a hash", async () => {
		const { admin, orgId } = await newOrg();
		const { token, url, expiresAt, status } = await inviteToken(admin);
		expect(status).toBe(201);
		expect(url).toBe(`https://lucidhire.io/invite/${token}`);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(INVITE_DAYS - 0.01);
		expect(days).toBeLessThanOrEqual(INVITE_DAYS);

		const rows = await db.select().from(invites).where(eq(invites.orgId, orgId));
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).toBe(await hashToken(token));
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it("uses the browser's origin for local development", async () => {
		const { admin } = await newOrg();
		const res = await call(admin, "POST", "/team/invites", undefined, { origin: "http://localhost:5173" });
		expect(((await res.json()) as { url: string }).url).toMatch(/^http:\/\/localhost:5173\/invite\//);
	});

	it("is for admins only (create, list, revoke)", async () => {
		const { admin, member } = await newOrg();
		expect((await call(member, "POST", "/team/invites")).status).toBe(403);
		expect((await call(member, "GET", "/team/invites")).status).toBe(403);
		const { token } = await inviteToken(admin);
		expect((await call(member, "DELETE", `/team/invites/${await hashToken(token)}`)).status).toBe(403);
	});

	it("lists pending invites, and revoking one removes it and kills its link", async () => {
		const { admin } = await newOrg();
		const first = await inviteToken(admin);
		await inviteToken(admin);
		const { invites: list } = (await (await call(admin, "GET", "/team/invites")).json()) as { invites: { id: string; expiresAt: string }[] };
		expect(list).toHaveLength(2);

		const id = await hashToken(first.token);
		expect((await call(admin, "DELETE", `/team/invites/${id}`)).status).toBe(204);
		expect((await call(admin, "DELETE", `/team/invites/${id}`)).status).toBe(404);
		const after = (await (await call(admin, "GET", "/team/invites")).json()) as { invites: unknown[] };
		expect(after.invites).toHaveLength(1);
		expect((await call("newcomer1", "GET", `/invites/${first.token}`)).status).toBe(404);
	});

	it("cannot revoke another company's invite", async () => {
		const mine = await newOrg();
		const other = await newOrg();
		const { token } = await inviteToken(other.admin);
		expect((await call(mine.admin, "DELETE", `/team/invites/${await hashToken(token)}`)).status).toBe(404);
		expect((await call("newcomer2", "GET", `/invites/${token}`)).status).toBe(200);
	});

	it("shows the company behind a link to a signed-in user, and nothing for a bad one", async () => {
		const { admin, name } = await newOrg();
		const { token } = await inviteToken(admin);
		const res = await call("newcomer3", "GET", `/invites/${token}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ company: { name } });
		expect((await call("newcomer3", "GET", "/invites/not-a-real-token")).status).toBe(404);
		expect((await call(null, "GET", `/invites/${token}`)).status).toBe(401);
	});

	it("lets a user without a company join as a member, once", async () => {
		const { admin, orgId } = await newOrg();
		const { token } = await inviteToken(admin);

		const res = await call("joiner1", "POST", `/invites/${token}/accept`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ org: { id: orgId, role: "member" } });
		expect(await findOrgForUser(db, "joiner1")).toMatchObject({ id: orgId, role: "member" });

		const [row] = await db.select().from(invites).where(eq(invites.tokenHash, await hashToken(token)));
		expect(row).toMatchObject({ acceptedBy: "joiner1" });
		// The link is used up.
		const again = await call("joiner2", "POST", `/invites/${token}/accept`);
		expect(again.status).toBe(404);
		expect(await findOrgForUser(db, "joiner2")).toBeNull();
		expect((await call("joiner2", "GET", `/invites/${token}`)).status).toBe(404);
	});

	it("lets only one of two simultaneous accepts in", async () => {
		const { admin, orgId } = await newOrg();
		const { token } = await inviteToken(admin);
		const results = await Promise.all([call("racer1", "POST", `/invites/${token}/accept`), call("racer2", "POST", `/invites/${token}/accept`)]);
		expect(results.map((res) => res.status).sort()).toEqual([200, 404]);
		const joined = await db.select().from(members).where(eq(members.orgId, orgId));
		expect(joined.filter((m) => m.userId.startsWith("racer"))).toHaveLength(1);
	});

	it("will not move someone who already has a company, and keeps the link usable", async () => {
		const { admin } = await newOrg();
		const other = await newOrg();
		const { token } = await inviteToken(admin);
		const res = await call(other.member, "POST", `/invites/${token}/accept`);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "has_company", message: "You already belong to a company" } });
		expect((await call("joiner3", "GET", `/invites/${token}`)).status).toBe(200);
	});

	it("rejects an expired link", async () => {
		const { orgId, admin } = await newOrg();
		const { token } = await createInvite(db, orgId, admin, Date.now() - 8 * 86_400_000);
		expect((await call("late1", "GET", `/invites/${token}`)).status).toBe(404);
		expect((await call("late1", "POST", `/invites/${token}/accept`)).status).toBe(404);
		expect(await findOrgForUser(db, "late1")).toBeNull();
		expect(await acceptInvite(db, token, "late1")).toEqual({ ok: false, reason: "invalid" });
	});
});
