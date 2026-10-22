import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth, verifyClerkSession, type SessionVerifier } from "./auth.ts";
import { ALLOWED_ORIGINS } from "./config.ts";
import type { AppEnv } from "./types.ts";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

type AppOptions = {
	verifySession?: SessionVerifier;
};

export function createApp({ verifySession = verifyClerkSession }: AppOptions = {}) {
	const app = new Hono<AppEnv>();

	app.use(async (c, next) => {
		const incomingId = c.req.header(REQUEST_ID_HEADER);
		const cfRay = c.req.header("cf-ray");
		const requestId =
			incomingId && REQUEST_ID_PATTERN.test(incomingId)
				? incomingId
				: cfRay || crypto.randomUUID();

		c.set("requestId", requestId);
		await next();
		c.res.headers.set(REQUEST_ID_HEADER, requestId);
	});

	app.use(
		cors({
			origin: ALLOWED_ORIGINS,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Authorization", "Content-Type"],
			exposeHeaders: [REQUEST_ID_HEADER],
			maxAge: 600,
		}),
	);

	app.get("/health", (c) =>
		c.json({ ok: true, service: "lucidhire-api" }, 200, {
			"Cache-Control": "no-store",
		}),
	);

	app.get("/me", requireAuth(verifySession), (c) =>
		c.json({ userId: c.get("userId") }, 200, { "Cache-Control": "no-store" }),
	);

	app.notFound((c) =>
		c.json(
			{
				error: {
					code: "not_found",
					message: `No route for ${c.req.method} ${c.req.path}`,
				},
			},
			404,
		),
	);

	app.onError((error, c) => {
		const requestId = c.get("requestId");
		console.error(`[${requestId}] unhandled error`, error);
		return c.json(
			{ error: { code: "internal_error", message: "Something went wrong" } },
			500,
			{ [REQUEST_ID_HEADER]: requestId },
		);
	});

	return app;
}
