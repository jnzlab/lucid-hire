import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type DescriptionEnhancer, recordAiUsage } from "./ai.ts";
import { requireOrg } from "./auth.ts";
import { candidateRoutes } from "./candidates-routes.ts";
import { deleteCvFiles, listFileKeys } from "./candidates.ts";
import { getDb } from "./db/client.ts";
import {
	createJob,
	createJobInput,
	deleteJob,
	enhanceInput,
	getJob,
	listJobs,
	updateJob,
	updateJobInput,
} from "./jobs.ts";
import type { AppEnv } from "./types.ts";

// Zod failures in the API's error shape: the first message, plus the first message for each field.
function validJson<T extends z.ZodType>(schema: T) {
	return zValidator("json", schema, (result, c) => {
		if (result.success) return;
		const fields: Record<string, string> = {};
		for (const issue of result.error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
		return c.json(
			{ error: { code: "invalid_input", message: result.error.issues[0]?.message ?? "Check the form", fields } },
			400,
		);
	});
}

const notFound = { error: { code: "not_found", message: "That job doesn't exist or isn't yours" } };

type JobRouteOptions = { auth: MiddlewareHandler<AppEnv>; enhance: DescriptionEnhancer };

// The signed-in company's jobs. Every route needs a session and a company.
export function jobRoutes({ auth, enhance }: JobRouteOptions) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/", async (c) => {
		const jobs = await listJobs(getDb(c.env.DB), c.get("org").id);
		return c.json({ jobs }, 200, { "Cache-Control": "no-store" });
	});

	routes.post("/", validJson(createJobInput), async (c) => {
		const job = await createJob(getDb(c.env.DB), c.get("org").id, c.get("userId"), c.req.valid("json"));
		return c.json({ job }, 201);
	});

	// Rewrites rough notes into a structured description. Nothing is saved: the recruiter reviews the
	// text in the form first. Capped per company by AI_RATE_LIMIT, and every call is metered.
	routes.post("/enhance", validJson(enhanceInput), async (c) => {
		const org = c.get("org");
		const { success } = await c.env.AI_RATE_LIMIT.limit({ key: org.id });
		if (!success) {
			return c.json(
				{ error: { code: "rate_limited", message: "That's 10 rewrites this minute. Try again in a minute." } },
				429,
			);
		}

		const usage = { orgId: org.id, userId: c.get("userId"), operation: "job_description_enhance" };
		const db = getDb(c.env.DB);
		try {
			const result = await enhance(c.env, c.req.valid("json"));
			c.executionCtx.waitUntil(
				recordAiUsage(db, {
					...usage,
					ok: true,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				}),
			);
			return c.json({ description: result.value });
		} catch (error) {
			console.error(`[${c.get("requestId")}] description enhancement failed`, error);
			c.executionCtx.waitUntil(recordAiUsage(db, { ...usage, ok: false }));
			return c.json(
				{ error: { code: "ai_unavailable", message: "Couldn't rewrite the description right now. Try again." } },
				502,
			);
		}
	});

	routes.get("/:id", async (c) => {
		const job = await getJob(getDb(c.env.DB), c.get("org").id, c.req.param("id"));
		return job ? c.json({ job }, 200, { "Cache-Control": "no-store" }) : c.json(notFound, 404);
	});

	routes.patch("/:id", validJson(updateJobInput), async (c) => {
		const job = await updateJob(getDb(c.env.DB), c.get("org").id, c.req.param("id"), c.req.valid("json"));
		return job ? c.json({ job }) : c.json(notFound, 404);
	});

	// Deleting is for admins only (legacy bug B10 let any member delete).
	routes.delete("/:id", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") {
			return c.json({ error: { code: "forbidden", message: "Only admins can delete jobs" } }, 403);
		}
		const db = getDb(c.env.DB);
		const id = c.req.param("id");
		// The candidate rows go with the job, so their R2 keys are collected first.
		const fileKeys = await listFileKeys(db, org.id, id);
		const deleted = await deleteJob(db, org.id, id);
		if (!deleted) return c.json(notFound, 404);
		c.executionCtx.waitUntil(deleteCvFiles(c.env.CVS, fileKeys));
		return c.body(null, 204);
	});

	routes.route("/", candidateRoutes());

	return routes;
}
