import { Hono, type MiddlewareHandler } from "hono";
import { type DescriptionEnhancer, recordAiUsage } from "./ai.ts";
import { requireOrg } from "./auth.ts";
import { candidateRoutes } from "./candidates-routes.ts";
import { deleteCvFiles, listFileKeys } from "./candidates.ts";
import { getDb } from "./db/client.ts";
import type { QuestionWriter } from "./interview-questions.ts";
import {
	COVER_MAX_BYTES,
	coverKeyFor,
	createJob,
	createJobInput,
	deleteJob,
	duplicateJob,
	enhanceInput,
	getJob,
	listJobs,
	setJobCover,
	sniffCover,
	listJobsQuery,
	JOBS_PAGE_SIZE,
	updateJob,
	updateJobInput,
} from "./jobs.ts";
import { questionRoutes } from "./questions-routes.ts";
import type { AppEnv } from "./types.ts";
import { validJson, validQuery } from "./validation.ts";

const notFound = { error: { code: "not_found", message: "That job doesn't exist or isn't yours" } };

type JobRouteOptions = {
	auth: MiddlewareHandler<AppEnv>;
	enhance: DescriptionEnhancer;
	writeQuestions: QuestionWriter;
};

// The signed-in company's jobs. Every route needs a session and a company.
export function jobRoutes({ auth, enhance, writeQuestions }: JobRouteOptions) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	// The list takes ?q= (title or description), ?status=, ?sort= and ?page=, 20 jobs to a page.
	routes.get("/", validQuery(listJobsQuery), async (c) => {
		const query = c.req.valid("query");
		const { jobs, total } = await listJobs(getDb(c.env.DB), c.get("org").id, query);
		return c.json({ jobs, total, page: query.page, pageSize: JOBS_PAGE_SIZE }, 200, { "Cache-Control": "no-store" });
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

	// A copy of a job as a new draft. Candidates stay with the original.
	routes.post("/:id/duplicate", async (c) => {
		const job = await duplicateJob(getDb(c.env.DB), c.get("org").id, c.get("userId"), c.req.param("id"));
		return job ? c.json({ job }, 201) : c.json(notFound, 404);
	});

	routes.patch("/:id", validJson(updateJobInput), async (c) => {
		const job = await updateJob(getDb(c.env.DB), c.get("org").id, c.req.param("id"), c.req.valid("json"));
		return job ? c.json({ job }) : c.json(notFound, 404);
	});

	// The optional cover image. The body is the raw image; what it is comes from its first bytes, not from the
	// Content-Type the client sent. One file per job, so a new one replaces the old.
	routes.put("/:id/cover", async (c) => {
		const org = c.get("org");
		const id = c.req.param("id");
		const db = getDb(c.env.DB);
		if (!(await getJob(db, org.id, id))) return c.json(notFound, 404);

		const declared = c.req.header("content-type")?.split(";")[0].trim().toLowerCase();
		if (declared !== "image/jpeg" && declared !== "image/png" && declared !== "image/webp") {
			return c.json({ error: { code: "not_image", message: "Upload a JPEG, PNG or WebP image" } }, 415);
		}
		const length = c.req.header("content-length");
		if (!length || !/^\d+$/.test(length)) {
			return c.json({ error: { code: "length_required", message: "Upload the image again" } }, 411);
		}
		if (Number(length) > COVER_MAX_BYTES) {
			return c.json({ error: { code: "too_large", message: "The cover image must be 2 MB or smaller" } }, 413);
		}
		const bytes = new Uint8Array(await c.req.arrayBuffer());
		if (bytes.byteLength === 0) return c.json({ error: { code: "empty_file", message: "That file is empty" } }, 400);
		const type = sniffCover(bytes);
		if (!type) return c.json({ error: { code: "not_image", message: "Upload a JPEG, PNG or WebP image" } }, 415);

		const key = coverKeyFor(org.id, id);
		await c.env.CVS.put(key, bytes, { httpMetadata: { contentType: type } });
		const job = await setJobCover(db, org.id, id, key);
		return job ? c.json({ job }) : c.json(notFound, 404);
	});

	// The cover for the job's own editor, which works for drafts too (the public route only serves open and closed jobs).
	routes.get("/:id/cover", async (c) => {
		const org = c.get("org");
		const id = c.req.param("id");
		const job = await getJob(getDb(c.env.DB), org.id, id);
		if (!job) return c.json(notFound, 404);
		const object = job.hasCover ? await c.env.CVS.get(coverKeyFor(org.id, id)) : null;
		if (!object) return c.json({ error: { code: "no_cover", message: "This job has no cover image" } }, 404);
		return c.body(object.body, 200, {
			"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
			"Content-Length": String(object.size),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		});
	});

	routes.delete("/:id/cover", async (c) => {
		const org = c.get("org");
		const id = c.req.param("id");
		const job = await setJobCover(getDb(c.env.DB), org.id, id, null);
		if (!job) return c.json(notFound, 404);
		c.executionCtx.waitUntil(deleteCvFiles(c.env.CVS, [coverKeyFor(org.id, id)]));
		return c.json({ job });
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
		const fileKeys = [...(await listFileKeys(db, org.id, id)), coverKeyFor(org.id, id)];
		const deleted = await deleteJob(db, org.id, id);
		if (!deleted) return c.json(notFound, 404);
		c.executionCtx.waitUntil(deleteCvFiles(c.env.CVS, fileKeys));
		return c.body(null, 204);
	});

	routes.route("/", candidateRoutes());
	routes.route("/", questionRoutes({ write: writeQuestions }));

	return routes;
}
