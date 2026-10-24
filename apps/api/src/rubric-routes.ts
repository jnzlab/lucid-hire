import { RUBRIC_MAX_ITEMS } from "@lucid-hire/scoring";
import { type Context, Hono } from "hono";
import { cancelChecks, startChecks } from "./candidates.ts";
import { type Db, getDb } from "./db/client.ts";
import { claimDraft, getJob, inOrg } from "./jobs.ts";
import {
	type RubricEditError,
	addRequirement,
	changeRubric,
	newRequirementInput,
	rubricChangesInput,
	startDraft,
} from "./rubric.ts";
import { hourPeriod, returnUnit, takeAiRequest } from "./usage.ts";
import type { AppEnv } from "./types.ts";
import { validJson } from "./validation.ts";

const err = (code: string, message: string) => ({ error: { code, message } });
const jobNotFound = err("job_not_found", "That job doesn't exist or isn't yours");
const notReady = err("rubric_not_ready", "The requirements aren't ready yet. Try again once they're drafted.");
const drafting = err("rubric_drafting", "The requirements are already being drafted.");

const EDIT_ERRORS = {
	job_not_found: [404, jobNotFound],
	rubric_not_ready: [409, notReady],
	unknown_requirement: [400, err("unknown_requirement", "That requirement isn't on this job.")],
	rubric_empty: [400, err("rubric_empty", "Keep at least one requirement on the job.")],
	rubric_full: [409, err("rubric_full", `This job already has ${RUBRIC_MAX_ITEMS} requirements. Remove one first.`)],
} as const satisfies Record<RubricEditError, readonly [number, unknown]>;

const editError = (c: Context<AppEnv>, error: RubricEditError) => {
	const [status, body] = EDIT_ERRORS[error];
	return c.json(body, status);
};

// Spends one AI request, as POST /jobs/enhance does: AI_RATE_LIMIT is a burst guard per company, and the plan's
// hourly allowance is counted. Null when the request may go ahead, otherwise the 429 to send.
async function takeAi(c: Context<AppEnv>, db: Db, orgId: string, now: number) {
	const { success } = await c.env.AI_RATE_LIMIT.limit({ key: orgId });
	if (!success) return c.json(err("rate_limited", "That's 10 AI requests this minute. Try again in a minute."), 429);
	const overHourly = await takeAiRequest(db, orgId, now);
	return overHourly ? c.json(overHourly.body, 429, overHourly.headers) : null;
}

// Workflows starts at most 100 instances a call.
const START_BATCH = 100;
const alreadyExists = (message: string) => /already.?exists/i.test(message);

// Starts one ScoreCvWorkflow "Check all" run per CV, 100 to a call. Each run is its own instance, named after the CV and
// the request. Returns the CVs whose run didn't start.
async function startCheckRuns(env: Env, ids: string[], now: number, requestId: string): Promise<string[]> {
	const failed: string[] = [];
	for (let at = 0; at < ids.length; at += START_BATCH) {
		const batch = ids.slice(at, at + START_BATCH);
		const instances = batch.map((candidateId) => ({
			id: `${candidateId}-check-${now}`,
			params: { candidateId, mode: "check" as const },
		}));
		try {
			const { errors } = await env.SCORE_CV.createBatch({ instances });
			for (const { index, message } of errors) if (!alreadyExists(message)) failed.push(batch[index]);
		} catch (error) {
			console.error(`[${requestId}] check runs did not start`, error);
			failed.push(...batch);
		}
	}
	return failed;
}

// A job's list of requirements. Mounted inside jobRoutes, so they sit behind its session and company checks, and any
// role may use them, as with PATCH /jobs/:id.
export function rubricRoutes() {
	const routes = new Hono<AppEnv>().basePath("/:jobId/rubric");

	// Weights, labels and removals. Every scored CV of the job is re-scored in the same request, without Gemini.
	routes.patch("/", validJson(rubricChangesInput), async (c) => {
		const job = await changeRubric(getDb(c.env.DB), c.get("org").id, c.req.param("jobId"), c.req.valid("json").changes);
		return typeof job === "string" ? editError(c, job) : c.json({ job });
	});

	// A requirement the recruiter adds. No CV has been checked against it yet, so the scores are worked out again
	// with it counting as not met until "Check all" reads it.
	routes.post("/requirements", validJson(newRequirementInput), async (c) => {
		const added = await addRequirement(getDb(c.env.DB), c.get("org").id, c.req.param("jobId"), c.req.valid("json"));
		return typeof added === "string" ? editError(c, added) : c.json(added, 201);
	});

	// "Check all": reads each scored CV again for only the requirements it misses, through the reading queue. One AI
	// request however many CVs it starts, and none when there is nothing to check.
	routes.post("/check", async (c) => {
		const db = getDb(c.env.DB);
		const org = c.get("org");
		const jobId = c.req.param("jobId");
		const job = await getJob(db, org.id, jobId);
		if (!job) return c.json(jobNotFound, 404);
		if (job.rubricStatus !== "ready") return c.json(notReady, 409);

		const now = Date.now();
		const limited = await takeAi(c, db, org.id, now);
		if (limited) return limited;

		const ids = await startChecks(db, org.id, jobId, now);
		if (ids.length === 0) {
			c.executionCtx.waitUntil(returnUnit(db, org.id, "ai_hour", hourPeriod(now)));
			return c.json({ started: 0 }, 202);
		}
		const failed = await startCheckRuns(c.env, ids, now, c.get("requestId"));
		await cancelChecks(db, failed);
		return c.json({ started: ids.length - failed.length }, 202);
	});

	// Drafts the list again from the job's current title and description. Requirements the new draft keeps (the same
	// detail, case and spacing aside) keep their id and so every CV's evidence; the rest are removed, and new ones are
	// not checked until "Check all".
	routes.post("/draft", async (c) => {
		const db = getDb(c.env.DB);
		const org = c.get("org");
		const jobId = c.req.param("jobId");
		const userId = c.get("userId");
		const job = await getJob(db, org.id, jobId);
		if (!job) return c.json(jobNotFound, 404);
		if (job.rubricStatus === "drafting") return c.json(drafting, 409);

		const now = Date.now();
		const limited = await takeAi(c, db, org.id, now);
		if (limited) return limited;

		const claimed = await claimDraft(db, inOrg(org.id, jobId), ["none", "ready", "failed"]);
		if (!claimed) {
			// Another request started a draft a moment ago, so this one cost nothing.
			c.executionCtx.waitUntil(returnUnit(db, org.id, "ai_hour", hourPeriod(now)));
			return c.json(drafting, 409);
		}
		// If the Workflow won't start, the job comes back with the draft failed, and drafting can be tried again.
		const started = await startDraft(c.env.DRAFT_RUBRIC, db, { jobId, version: claimed.version, userId }, { claimed: true });
		return c.json({ job: started ? claimed.job : { ...claimed.job, rubricStatus: "failed" as const } }, 202);
	});

	return routes;
}
