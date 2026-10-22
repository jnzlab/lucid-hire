import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type DescriptionEnhancer, enhanceWithGemini } from "./ai.ts";
import { requireAuth, verifyClerkSession, type SessionVerifier } from "./auth.ts";
import { ALLOWED_ORIGINS } from "./config.ts";
import { getDb } from "./db/client.ts";
import { type QuestionWriter, writeQuestionsWithGemini } from "./interview-questions.ts";
import { billingRoutes } from "./billing-routes.ts";
import { type UserDirectory, clerkDirectory } from "./clerk.ts";
import { jobRoutes } from "./jobs-routes.ts";
import { overviewRoutes } from "./overview-routes.ts";
import { type PolarFetch, polarFetcher } from "./polar.ts";
import { type CaptchaVerifier, verifyTurnstile } from "./public.ts";
import { publicRoutes } from "./public-routes.ts";
import { webhookRoutes } from "./webhook-routes.ts";
import { ORG_NAME_MAX, ORG_NAME_MIN, createOrgForUser, findOrgForUser, normalizeOrgName } from "./orgs.ts";
import type { AppEnv } from "./types.ts";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

type AppOptions = {
	verifySession?: SessionVerifier;
	enhanceDescription?: DescriptionEnhancer;
	writeQuestions?: QuestionWriter;
	verifyCaptcha?: CaptchaVerifier;
	// How the API reaches Polar; tests replace it.
	polar?: (env: Env) => PolarFetch;
	// Where names and emails come from (Clerk).
	directory?: UserDirectory;
};

export function createApp({
	verifySession = verifyClerkSession,
	enhanceDescription = enhanceWithGemini,
	writeQuestions = writeQuestionsWithGemini,
	verifyCaptcha = verifyTurnstile,
	polar = (env) => polarFetcher(env.POLAR_ACCESS_TOKEN),
	directory = clerkDirectory,
}: AppOptions = {}) {
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
			allowHeaders: ["Authorization", "Content-Type", "X-Applicant-Email", "X-Turnstile-Token", "X-File-Name"],
			// Content-Disposition: the web app names a download after it.
			exposeHeaders: [REQUEST_ID_HEADER, "Content-Disposition"],
			maxAge: 600,
		}),
	);

	app.get("/health", (c) =>
		c.json({ ok: true, service: "lucidhire-api" }, 200, {
			"Cache-Control": "no-store",
		}),
	);

	const auth = requireAuth(verifySession);

	// The signed-in user and their company, or `org: null` until onboarding creates one.
	app.get("/me", auth, async (c) => {
		const userId = c.get("userId");
		const org = await findOrgForUser(getDb(c.env.DB), userId);
		return c.json({ userId, org }, 200, { "Cache-Control": "no-store" });
	});

	// Onboarding: creates the user's company with them as admin. Repeating it returns the same company.
	app.post("/orgs", auth, async (c) => {
		const body = await c.req.json<{ name?: unknown }>().catch(() => null);
		const name = normalizeOrgName(body?.name);
		if (!name) {
			return c.json(
				{
					error: {
						code: "invalid_name",
						message: `Enter a company name between ${ORG_NAME_MIN} and ${ORG_NAME_MAX} characters`,
					},
				},
				400,
			);
		}

		const { org, created } = await createOrgForUser(getDb(c.env.DB), c.get("userId"), name);
		return c.json({ org }, created ? 201 : 200);
	});

	app.route("/webhooks", webhookRoutes({ polar }));
	app.route("/billing", billingRoutes({ auth, polar, directory }));
	app.route("/jobs", jobRoutes({ auth, enhance: enhanceDescription, writeQuestions }));

	app.route("/overview", overviewRoutes({ auth }));

	// Unauthenticated: the public job page, its cover image, the apply form and the sitemap.
	app.route("/public", publicRoutes({ verifyCaptcha }));

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
		// Hono's own 4xx errors, such as a malformed JSON body, keep their status in our error shape.
		if (error instanceof HTTPException && error.status < 500) {
			return c.json({ error: { code: "bad_request", message: error.message } }, error.status);
		}

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
