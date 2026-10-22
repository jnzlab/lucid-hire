import { Hono, type MiddlewareHandler } from "hono";
import { requireOrg } from "./auth.ts";
import type { UserDirectory } from "./clerk.ts";
import { ALLOWED_ORIGINS, APP_ORIGIN } from "./config.ts";
import { getDb } from "./db/client.ts";
import { findOrgForUser } from "./orgs.ts";
import { LAST_ADMIN_MESSAGE, acceptInvite, changeRole, createInvite, findInvite, listInvites, listTeam, revokeInvite, roleInput } from "./team.ts";
import type { AppEnv } from "./types.ts";
import { validJson } from "./validation.ts";

const adminOnly = {
	error: { code: "forbidden", message: "Only admins can change the plan or roles" },
};
const memberNotFound = { error: { code: "member_not_found", message: "That person isn't in your company" } };
const inviteInvalid = {
	error: { code: "invite_invalid", message: "This invite link has expired, been used or been withdrawn. Ask for a new one." },
};

// The company's roster and invite links. Every role can read the roster; changing it is for admins.
export function teamRoutes({ auth, directory }: { auth: MiddlewareHandler<AppEnv>; directory: UserDirectory }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/", async (c) => {
		const members = await listTeam(getDb(c.env.DB), c.env, directory, c.get("org").id, c.get("userId"));
		return c.json({ members }, 200, { "Cache-Control": "no-store" });
	});

	routes.post("/invites", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(adminOnly, 403);
		const { token, expiresAt } = await createInvite(getDb(c.env.DB), org.id, c.get("userId"));
		const origin = ALLOWED_ORIGINS.includes(c.req.header("origin") ?? "") ? (c.req.header("origin") as string) : APP_ORIGIN;
		return c.json({ url: `${origin}/invite/${token}`, expiresAt }, 201);
	});

	routes.get("/invites", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(adminOnly, 403);
		return c.json({ invites: await listInvites(getDb(c.env.DB), org.id) }, 200, { "Cache-Control": "no-store" });
	});

	routes.delete("/invites/:id", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(adminOnly, 403);
		const revoked = await revokeInvite(getDb(c.env.DB), org.id, c.req.param("id"));
		return revoked ? c.body(null, 204) : c.json(inviteInvalid, 404);
	});

	routes.patch("/:userId", validJson(roleInput), async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(adminOnly, 403);
		const userId = c.req.param("userId");
		const { role } = c.req.valid("json");

		const result = await changeRole(getDb(c.env.DB), org.id, userId, role);
		if (result.ok) return c.json({ member: { userId, role: result.role } });
		if (result.reason === "not_found") return c.json(memberNotFound, 404);
		return c.json({ error: { code: "last_admin", message: LAST_ADMIN_MESSAGE } }, 409);
	});

	return routes;
}

// Invite links, opened by someone who is signed in but may not have a company yet.
export function inviteRoutes({ auth }: { auth: MiddlewareHandler<AppEnv> }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth);

	routes.get("/:token", async (c) => {
		const invite = await findInvite(getDb(c.env.DB), c.req.param("token"));
		if (!invite) return c.json(inviteInvalid, 404);
		return c.json({ company: { name: invite.company } }, 200, { "Cache-Control": "no-store" });
	});

	routes.post("/:token/accept", async (c) => {
		const db = getDb(c.env.DB);
		const hasCompany = { error: { code: "has_company", message: "You already belong to a company" } };
		if (await findOrgForUser(db, c.get("userId"))) return c.json(hasCompany, 409);

		const result = await acceptInvite(db, c.req.param("token"), c.get("userId"));
		if (result.ok) return c.json({ org: result.org });
		return result.reason === "has_company" ? c.json(hasCompany, 409) : c.json(inviteInvalid, 404);
	});

	return routes;
}
