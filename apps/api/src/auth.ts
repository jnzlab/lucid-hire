import { verifyToken } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import { ALLOWED_ORIGINS } from "./config.ts";
import { getDb } from "./db/client.ts";
import { findOrgForUser } from "./orgs.ts";
import type { AppEnv } from "./types.ts";

export type SessionVerifier = (token: string, env: Env) => Promise<{ userId: string }>;

// Verifies a Clerk session token against the instance that issued it; throws when it is invalid or expired.
export const verifyClerkSession: SessionVerifier = async (token, env) => {
	const payload = await verifyToken(token, {
		secretKey: env.CLERK_SECRET_KEY,
		authorizedParties: ALLOWED_ORIGINS,
	});
	return { userId: payload.sub };
};

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function requireAuth(verify: SessionVerifier) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const token = c.req.header("authorization")?.match(BEARER_PATTERN)?.[1];
		if (!token) {
			return c.json(
				{ error: { code: "unauthenticated", message: "Sign in to continue" } },
				401,
			);
		}

		try {
			const { userId } = await verify(token, c.env);
			c.set("userId", userId);
		} catch {
			return c.json(
				{ error: { code: "invalid_session", message: "Your session is invalid or has expired" } },
				401,
			);
		}

		await next();
	});
}

// Runs after requireAuth. Loads the user's company, so routes behind it only ever touch that company's data.
export const requireOrg = createMiddleware<AppEnv>(async (c, next) => {
	const org = await findOrgForUser(getDb(c.env.DB), c.get("userId"));
	if (!org) {
		return c.json({ error: { code: "no_org", message: "Name your company before you post jobs" } }, 403);
	}

	c.set("org", org);
	await next();
});
