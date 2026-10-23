import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { getDb } from "./db/client.ts";
import { members } from "./db/schema.ts";
import { createOrgForUser, findOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
	const testD1 = await createTestD1();
	env = { CLERK_SECRET_KEY: "sk_test_unit", DB: testD1.d1 } as Env;
	dispose = testD1.dispose;
});

afterAll(() => dispose());

const acceptOnlyGoodToken: SessionVerifier = async (token) => {
	if (token !== "good-token") throw new Error("invalid token");
	return { userId: "user_123" };
};

const app = createApp({ verifySession: acceptOnlyGoodToken });

describe("GET /health", () => {
	it("reports the service as up without caching", async () => {
		const res = await app.request("/health", {}, env);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, service: "lucidhire-api" });
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-request-id")).toBeTruthy();
	});

	it("echoes a well-formed request id and replaces a malformed one", async () => {
		const kept = await app.request("/health", { headers: { "x-request-id": "abc-123" } }, env);
		expect(kept.headers.get("x-request-id")).toBe("abc-123");

		const replaced = await app.request("/health", { headers: { "x-request-id": "bad id!" } }, env);
		expect(replaced.headers.get("x-request-id")).not.toBe("bad id!");
	});
});

describe("CORS", () => {
	it("allows the live app origin, including the preflight for an authorized request", async () => {
		const res = await app.request(
			"/me",
			{
				method: "OPTIONS",
				headers: {
					origin: "https://lucidhire.io",
					"access-control-request-method": "GET",
					"access-control-request-headers": "authorization",
				},
			},
			env,
		);

		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("https://lucidhire.io");
		expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
	});

	it("allows every custom header the web app sends", async () => {
		// The browser drops a request whose header isn't allowed here, so each one the web app sets must be listed.
		const sent = ["authorization", "content-type", "x-applicant-email", "x-applicant-name", "x-turnstile-token", "x-file-name"];
		const res = await app.request(
			"/jobs/job_1/candidates",
			{
				method: "OPTIONS",
				headers: {
					origin: "https://lucidhire.io",
					"access-control-request-method": "POST",
					"access-control-request-headers": sent.join(","),
				},
			},
			env,
		);

		const allowed = res.headers.get("access-control-allow-headers")?.toLowerCase().split(",") ?? [];
		for (const header of sent) expect(allowed).toContain(header);
	});

	it("does not grant other origins", async () => {
		const res = await app.request("/health", { headers: { origin: "https://evil.example" } }, env);

		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("GET /me", () => {
	it("rejects a request without a bearer token", async () => {
		const res = await app.request("/me", {}, env);

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
	});

	it("rejects an invalid session token", async () => {
		const res = await app.request("/me", { headers: { authorization: "Bearer forged" } }, env);

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { code: "invalid_session" } });
	});

	it("returns the signed-in user, with no company before onboarding", async () => {
		const res = await app.request("/me", { headers: { authorization: "Bearer good-token" } }, env);

		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({ userId: "user_123", org: null });
	});
});

describe("POST /orgs", () => {
	const post = (body: unknown, authorization = "Bearer good-token") =>
		app.request(
			"/orgs",
			{
				method: "POST",
				headers: { authorization, "content-type": "application/json" },
				body: typeof body === "string" ? body : JSON.stringify(body),
			},
			env,
		);

	it("requires a session", async () => {
		const res = await post({ name: "Acme" }, "");

		expect(res.status).toBe(401);
	});

	it("rejects a missing, too short or unparseable name", async () => {
		for (const body of [{}, { name: " A " }, { name: 7 }, "not json"]) {
			const res = await post(body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_name" } });
		}
	});

	it("creates the company once, then returns it, and /me reports it", async () => {
		const created = await post({ name: "  Acme   Hiring " });
		expect(created.status).toBe(201);
		const { org } = (await created.json()) as { org: { id: string } };
		expect(org).toMatchObject({ name: "Acme Hiring", role: "admin" });

		const repeated = await post({ name: "Another Name" });
		expect(repeated.status).toBe(200);
		expect(await repeated.json()).toEqual({ org });

		const me = await app.request("/me", { headers: { authorization: "Bearer good-token" } }, env);
		expect(await me.json()).toEqual({ userId: "user_123", org });
	});
});

describe("PATCH /orgs/current", () => {
	// Tokens are "t:<userId>" here, so an admin, a member and another company can each be signed in.
	const asUser = createApp({
		verifySession: async (token) => {
			if (!token.startsWith("t:")) throw new Error("invalid token");
			return { userId: token.slice(2) };
		},
	});
	const rename = (user: string | null, body: unknown) =>
		asUser.request(
			"/orgs/current",
			{
				method: "PATCH",
				headers: { ...(user ? { authorization: `Bearer t:${user}` } : {}), "content-type": "application/json" },
				body: typeof body === "string" ? body : JSON.stringify(body),
			},
			env,
		);
	let orgId: string;

	beforeAll(async () => {
		const db = getDb(env.DB);
		orgId = (await createOrgForUser(db, "user_rename_admin", "Sprite Labs")).org.id;
		await db.insert(members).values({ orgId, userId: "user_rename_member", role: "member" });
		await createOrgForUser(db, "user_rename_other", "Other Co");
	});

	it("lets an admin rename the company, tidied like onboarding, and /me reports the new name", async () => {
		const res = await rename("user_rename_admin", { name: "  Sprite   Labs Ltd " });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ org: { id: orgId, name: "Sprite Labs Ltd", role: "admin" } });

		const me = await asUser.request("/me", { headers: { authorization: "Bearer t:user_rename_member" } }, env);
		expect(await me.json()).toMatchObject({ org: { id: orgId, name: "Sprite Labs Ltd", role: "member" } });
		// Only this company changed.
		expect((await findOrgForUser(getDb(env.DB), "user_rename_other"))?.name).toBe("Other Co");
	});

	it("is for admins only, whatever the body", async () => {
		for (const body of [{ name: "Member Co" }, { name: "" }]) {
			const res = await rename("user_rename_member", body);
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
		}
		expect((await findOrgForUser(getDb(env.DB), "user_rename_admin"))?.name).toBe("Sprite Labs Ltd");
	});

	it("rejects a missing, too short, too long or unparseable name", async () => {
		for (const body of [{}, { name: " A " }, { name: "x".repeat(81) }, { name: 7 }, "not json"]) {
			const res = await rename("user_rename_admin", body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_name" } });
		}
	});

	it("needs a session and a company", async () => {
		expect((await rename(null, { name: "Nobody" })).status).toBe(401);
		const res = await rename("user_without_org", { name: "Nobody" });
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: { code: "no_org" } });
	});
});

describe("unknown routes", () => {
	it("answer with a JSON 404", async () => {
		const res = await app.request("/nope", {}, env);

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
	});
});
