import { COMPANY_SCORING_CAP, PLANS } from "@lucid-hire/plans";
import { visibleItems } from "@lucid-hire/scoring";
import type { WorkflowStep } from "cloudflare:workers";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { GEMINI_STEP, recordAiUsage } from "./ai.ts";
import { STALE_SCORING_MS } from "./candidates.ts";
import { GLOBAL_SCORING_CAP } from "./config.ts";
import { type CvScore, type CvScorer, isUnreadableFileError } from "./cv-scorer.ts";
import type { Db } from "./db/client.ts";
import { candidates, jobs, organizations } from "./db/schema.ts";
import { NEEDS_DRAFT, claimDraft } from "./jobs.ts";
import { effectivePlanSql } from "./plan-state.ts";
import { type DraftRubricParams, rubricOfCandidate, scoreSql } from "./rubric.ts";

// The logic behind ScoreCvWorkflow, as plain functions so tests can run them without the Workers runtime: the work of
// each step, and the run that strings the steps together. The Workflow class only hands the run its real step and
// bindings.

export const CV_SCORE_OPERATION = "cv_score";
export const UNREADABLE_MESSAGE = "We couldn't read this file as a CV.";
export const SCORING_FAILED_MESSAGE = "Scoring failed. Try again.";
export const QUEUE_FULL_MESSAGE = "The reading queue is full. Try again in a few minutes.";
export const RUBRIC_FAILED_MESSAGE = "We couldn't set up this job's requirements. Try again.";

// A failure that retrying can't fix. The Workflow turns it into a NonRetryableError.
export class PermanentScoringError extends Error {}

// No slot came free within the wait limit. Retrying later usually works.
export class QueueTimeoutError extends Error {}

// The job's requirements weren't drafted, or not within the wait limit. Retrying later drafts them again.
export class RubricUnavailableError extends Error {}

// What a run reads. `initial` is a new CV and `reread` a retry or a Re-read: both read every requirement still on the
// job and replace the CV's evidence. `check` is a "Check all" run: it reads only the requirements the CV was missing
// (`check_ids`), adds that evidence to what the CV has, and leaves the CV scored throughout.
export const SCORE_MODES = ["initial", "reread", "check"] as const;
export type ScoreMode = (typeof SCORE_MODES)[number];
// Runs started before modes existed have none, and are initial.
export type ScoreCvParams = { candidateId: string; mode?: ScoreMode };

// Which column a run moves through the reading queue: a scoring run moves `status` (queued, then scoring) and a "Check
// all" run `check_state` (queued, then checking), so a checked CV stays scored and ranked while it is read again.
export type QueueRun = "score" | "check";
const QUEUE = {
	score: { column: sql.raw("status"), reading: sql.raw("'scoring'") },
	check: { column: sql.raw("check_state"), reading: sql.raw("'checking'") },
} as const;
export const queueRunOf = (mode: ScoreMode): QueueRun => (mode === "check" ? "check" : "score");

// What the "score" step returns to the Workflow: small JSON, well under the 1 MiB step limit. `usage` is null when
// there was nothing left to read, so no Gemini call was made.
export type ScoreStepOutput = {
	result: CvScore;
	usage: { inputTokens: number | null; outputTokens: number | null } | null;
};

// How long a waiting CV vouches for its place in the queue: a waiter that hasn't refreshed `updated_at` this
// recently is a dead Workflow, and must not hold anyone up.
export const WAITER_LIVE_MS = 60 * 1000;

// Begins a CV's run: its place in the queue is the time now, minus the head start of its company's plan. Each run
// is a new Workflow instance, so a retry gets a fresh place. False when the candidate was deleted, or its run dropped.
export async function enterQueue(
	db: Db,
	candidateId: string,
	now: number = Date.now(),
	run: QueueRun = "score",
): Promise<boolean> {
	const { column, reading } = QUEUE[run];
	const headStartMs = sql`(SELECT CASE ${effectivePlanSql(now)}
		WHEN 'max' THEN ${PLANS.max.queueHeadStartSec * 1000} WHEN 'pro' THEN ${PLANS.pro.queueHeadStartSec * 1000}
		ELSE ${PLANS.free.queueHeadStartSec * 1000} END FROM ${organizations} WHERE ${organizations.id} = candidates.org_id)`;
	const updated = await db.all<{ id: string }>(sql`UPDATE candidates
		SET queue_priority_at = ${now} - COALESCE(${headStartMs}, 0), updated_at = ${now}
		WHERE id = ${candidateId} AND ${column} IN ('queued', ${reading})
		RETURNING id`);
	return updated.length > 0;
}

export type SlotResult = "started" | "waiting" | "gone";

// Takes a reading slot in ONE guarded UPDATE (queued -> scoring, or queued -> checking), so two Workflows can't both
// take the last one: the company has fewer than COMPANY_SCORING_CAP CVs being read, fewer than GLOBAL_SCORING_CAP
// overall, and no other live waiter is ahead of this CV while its own company still has room. Scoring runs and "Check
// all" runs count alike and wait in one order. Reading rows that went stale are dead Workflows and hold no slot. A CV
// that has to wait gets a heartbeat instead, so the stale rule never fails it.
export async function takeSlot(
	db: Db,
	candidateId: string,
	now: number = Date.now(),
	run: QueueRun = "score",
): Promise<SlotResult> {
	const { column, reading: readingState } = QUEUE[run];
	const staleBefore = now - STALE_SCORING_MS;
	const liveAfter = now - WAITER_LIVE_MS;
	const priority = (alias: string) => sql.raw(`COALESCE(${alias}.queue_priority_at, ${alias}.created_at)`);
	// Each side of the OR has its own index, (status, updated_at) and (check_state, updated_at).
	const reading = (alias: string) => {
		const a = sql.raw(alias);
		return sql`((${a}.status = 'scoring' AND ${a}.updated_at > ${staleBefore})
			OR (${a}.check_state = 'checking' AND ${a}.updated_at > ${staleBefore}))`;
	};
	const waiting = sql`(w.status = 'queued' OR w.check_state = 'queued')`;

	// "Reading" counts exclude this CV: a retried step finds it already reading and must not count itself.
	const started = await db.all<{ id: string }>(sql`UPDATE candidates
		SET ${column} = ${readingState}, updated_at = ${now}
		WHERE id = ${candidateId} AND ${column} IN ('queued', ${readingState})
		AND (SELECT count(*) FROM candidates s WHERE s.org_id = candidates.org_id AND s.id != candidates.id
			AND ${reading("s")}) < ${COMPANY_SCORING_CAP}
		AND (SELECT count(*) FROM candidates s WHERE s.id != candidates.id AND ${reading("s")}) < ${GLOBAL_SCORING_CAP}
		AND NOT EXISTS (
			SELECT 1 FROM candidates w
			WHERE ${waiting} AND w.id != candidates.id AND w.updated_at > ${liveAfter}
			AND (${priority("w")} < ${priority("candidates")}
				OR (${priority("w")} = ${priority("candidates")} AND w.id < candidates.id))
			AND (SELECT count(*) FROM candidates s WHERE s.org_id = w.org_id AND ${reading("s")}) < ${COMPANY_SCORING_CAP}
		)
		RETURNING id`);
	if (started.length > 0) return "started";

	// Already reading means an earlier try of this step took the slot and only its answer was lost: the slot is
	// still this CV's, even if a better-placed waiter has arrived since.
	const [held] = await db.all<{ state: string }>(sql`UPDATE candidates SET updated_at = ${now}
		WHERE id = ${candidateId} AND ${column} IN ('queued', ${readingState})
		RETURNING ${column} AS state`);
	if (!held) return "gone";
	return held.state === "queued" ? "waiting" : "started";
}

// Where the job's requirements stand for a run: ready to read against, being drafted, failed, or "gone" when the
// candidate was deleted (or its "Check all" run dropped) and there is nothing to do.
export type RubricWait = "ready" | "drafting" | "failed" | "gone";

// Starts the draft's Workflow (rubric.ts startDraft, with the DRAFT_RUBRIC binding). True when it is running.
export type DraftLauncher = (params: DraftRubricParams, options: { claimed: boolean }) => Promise<boolean>;

async function runJob(db: Db, candidateId: string, run: QueueRun) {
	const [row] = await db
		.select({
			jobId: jobs.id,
			status: jobs.rubricStatus,
			version: jobs.rubricVersion,
			createdBy: candidates.createdBy,
			checkState: candidates.checkState,
		})
		.from(candidates)
		.innerJoin(jobs, eq(jobs.id, candidates.jobId))
		.where(eq(candidates.id, candidateId))
		.limit(1);
	// A "Check all" run is dropped when a full read of the CV begins instead.
	return !row || (run === "check" && row.checkState === null) ? null : row;
}

export async function readRubric(db: Db, candidateId: string, run: QueueRun = "score"): Promise<RubricWait> {
	const job = await runJob(db, candidateId, run);
	if (!job) return "gone";
	return job.status === "ready" ? "ready" : job.status === "drafting" ? "drafting" : "failed";
}

// A CV is read against its job's one list of requirements, so the list has to exist first. A job that has none (or
// whose last draft failed) is claimed for a draft here and its Workflow started. For a draft already under way, its
// Workflow is started again in case whoever claimed it couldn't: an instance that exists makes that a no-op.
export async function prepareRubric(
	db: Db,
	launch: DraftLauncher,
	candidateId: string,
	run: QueueRun = "score",
): Promise<RubricWait> {
	const job = await runJob(db, candidateId, run);
	if (!job) return "gone";
	if (job.status === "ready") return "ready";
	const draft = { jobId: job.jobId, userId: job.createdBy };
	if (job.status === "drafting") {
		await launch({ ...draft, version: job.version }, { claimed: false });
		return "drafting";
	}
	const claimed = await claimDraft(db, eq(jobs.id, job.jobId), NEEDS_DRAFT);
	// Another run claimed it a moment ago.
	if (!claimed) return readRubric(db, candidateId, run);
	return (await launch({ ...draft, version: claimed.version }, { claimed: true })) ? "drafting" : "failed";
}

// What an empty read leaves: a "Check all" run with nothing left to read only ends the run.
const NOTHING_READ: CvScore = {
	name: "",
	headline: "",
	summary: "",
	evidence: {},
	profile: { links: [], skills: [], experience: [], education: [], certifications: [] },
};

export async function scoreCandidate(
	db: Db,
	bucket: R2Bucket,
	scorer: CvScorer,
	candidateId: string,
	mode: ScoreMode = "initial",
): Promise<ScoreStepOutput | null> {
	const [row] = await db
		.select({
			fileKey: candidates.fileKey,
			orgId: candidates.orgId,
			createdBy: candidates.createdBy,
			jobId: candidates.jobId,
			checkState: candidates.checkState,
			checkIds: candidates.checkIds,
			title: jobs.title,
			description: jobs.description,
			rubric: jobs.rubric,
		})
		.from(candidates)
		.innerJoin(jobs, eq(jobs.id, candidates.jobId))
		.where(eq(candidates.id, candidateId))
		.limit(1);
	// Null when the candidate was deleted during the run (or its "Check all" run dropped), so the Workflow can stop
	// quietly.
	if (!row || (mode === "check" && row.checkState !== "checking")) return null;

	const rubric = visibleItems(row.rubric ?? []).map(({ id, detail }) => ({ id, detail }));
	if (rubric.length === 0) throw new Error("The job has no requirements to read the CV against");
	// A requirement removed since the run was queued isn't read.
	const onlyIds = mode === "check" ? (row.checkIds ?? []).filter((id) => rubric.some((item) => item.id === id)) : undefined;
	if (onlyIds?.length === 0) return { result: NOTHING_READ, usage: null };

	const object = await bucket.get(row.fileKey);
	if (!object) throw new PermanentScoringError("The uploaded file is missing");
	// A native copy of at most 5 MB: no parsing, no base64.
	const pdf = new Uint8Array(await object.arrayBuffer());

	try {
		const { value, inputTokens, outputTokens } = await scorer({
			jobTitle: row.title,
			jobDescription: row.description,
			rubric,
			pdf,
			...(onlyIds && { onlyIds }),
		});
		return { result: value, usage: { inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null } };
	} catch (error) {
		// One usage row per Gemini call, so a call that failed is booked here, per attempt. A run that fails
		// before calling Gemini (no candidate, no file) books nothing.
		await recordAiUsage(db, {
			orgId: row.orgId,
			userId: row.createdBy,
			jobId: row.jobId,
			operation: CV_SCORE_OPERATION,
			ok: false,
		});
		if (isUnreadableFileError(error)) {
			throw new PermanentScoringError("Gemini could not read the file", { cause: error });
		}
		throw error;
	}
}

// Saves what was read. The score is worked out in the same UPDATE, in SQL, from the job's requirements as they are
// NOW and the CV's new evidence, so a weight a recruiter changed while Gemini was reading still counts. A full read
// replaces the CV's evidence and what the CV says; a "Check all" run adds its evidence to the CV's and touches nothing
// else, and only while the run is still the CV's.
export async function saveScore(
	db: Db,
	candidateId: string,
	{ result, usage }: ScoreStepOutput,
	mode: ScoreMode = "initial",
): Promise<void> {
	const billed = { orgId: candidates.orgId, jobId: candidates.jobId, createdBy: candidates.createdBy };
	let row: { orgId: string; jobId: string; createdBy: string } | undefined;
	if (mode === "check") {
		const evidence = sql`json_patch(coalesce(${candidates.evidence}, '{}'), ${JSON.stringify(result.evidence)})`;
		[row] = await db
			.update(candidates)
			.set({ evidence, score: scoreSql(rubricOfCandidate, evidence), checkState: null, checkIds: null })
			.where(and(eq(candidates.id, candidateId), eq(candidates.status, "scored"), eq(candidates.checkState, "checking")))
			.returning(billed);
		// The run was dropped while Gemini was reading, but the call was made: it is still booked.
		if (!row && usage) [row] = await db.select(billed).from(candidates).where(eq(candidates.id, candidateId)).limit(1);
	} else {
		[row] = await db
			.update(candidates)
			.set({
				status: "scored",
				error: null,
				// A name the recruiter gave at upload stays; the CV's own name fills in only when there is none.
				name: sql`coalesce(${candidates.name}, ${result.name || null})`,
				headline: result.headline || null,
				summary: result.summary,
				evidence: result.evidence,
				profile: result.profile,
				score: scoreSql(rubricOfCandidate, sql`${JSON.stringify(result.evidence)}`),
				scoredAt: new Date(),
				checkState: null,
				checkIds: null,
			})
			.where(eq(candidates.id, candidateId))
			.returning(billed);
	}
	// No row means the candidate was deleted while Gemini was working, and there is nobody to bill.
	if (!row || !usage) return;

	await recordAiUsage(db, {
		orgId: row.orgId,
		userId: row.createdBy,
		jobId: row.jobId,
		operation: CV_SCORE_OPERATION,
		ok: true,
		inputTokens: usage.inputTokens ?? undefined,
		outputTokens: usage.outputTokens ?? undefined,
	});
}

// The Workflow rethrows our PermanentScoringError as a NonRetryableError, and the engine hands that back
// to the Workflow code when the step is given up on, so both mean "the file is the problem".
export function failureMessage(error: unknown): string {
	const permanent =
		error instanceof PermanentScoringError || (error instanceof Error && error.name === "NonRetryableError");
	if (error instanceof QueueTimeoutError) return QUEUE_FULL_MESSAGE;
	if (error instanceof RubricUnavailableError) return RUBRIC_FAILED_MESSAGE;
	return permanent ? UNREADABLE_MESSAGE : SCORING_FAILED_MESSAGE;
}

// The usage rows for failed Gemini calls are written where the calls happen (see scoreCandidate), not here.
export async function markFailed(db: Db, candidateId: string, message: string): Promise<void> {
	await db.update(candidates).set({ status: "failed", error: message }).where(eq(candidates.id, candidateId));
}

// Ends a "Check all" run that failed. The CV stays scored with the evidence it had, so "Check all" can try again.
export async function endCheck(db: Db, candidateId: string): Promise<void> {
	await db
		.update(candidates)
		.set({ checkState: null, checkIds: null })
		.where(and(eq(candidates.id, candidateId), isNotNull(candidates.checkState)));
}

// A run waiting for its job's requirements looks every 10 seconds, for up to 5 minutes. A waiting CV looks for a free
// slot every 10 seconds, for up to 30 minutes. Each round is two steps (a check and a sleep), so even both together
// stay far below the 1024 steps an instance may have.
export const RUBRIC_POLL = "10 seconds";
export const RUBRIC_MAX_POLLS = 30;
export const QUEUE_POLL = "10 seconds";
export const QUEUE_MAX_POLLS = 180;

export type ScoreRunDeps = {
	db: Db;
	bucket: R2Bucket;
	scorer: CvScorer;
	launchDraft: DraftLauncher;
	// The engine's NonRetryableError, which only exists inside the Workers runtime.
	nonRetryable: (message: string) => Error;
};

// One run for one CV: wait for the job's requirements, take a reading slot, one Gemini call, then save. Every failure
// from the first step on ends in the "fail" step, so a CV is never left queued or scoring (a "Check all" run is
// ended instead, and the CV stays scored).
export async function runScoreCv(
	step: Pick<WorkflowStep, "do" | "sleep">,
	{ db, bucket, scorer, launchDraft, nonRetryable }: ScoreRunDeps,
	{ candidateId, mode = "initial" }: ScoreCvParams,
): Promise<void> {
	const run = queueRunOf(mode);
	try {
		let rubric = await step.do("rubric", () => prepareRubric(db, launchDraft, candidateId, run));
		for (let poll = 0; poll < RUBRIC_MAX_POLLS && rubric === "drafting"; poll++) {
			await step.sleep(`rubric-wait-${poll}`, RUBRIC_POLL);
			rubric = await step.do(`rubric-${poll}`, () => readRubric(db, candidateId, run));
		}
		if (rubric === "gone") return;
		if (rubric !== "ready") throw new RubricUnavailableError(`The job's requirements are ${rubric}`);

		// The place in the reading queue is fixed once, then the CV waits for a slot (at most 5 per company and
		// 10 in all). Waiting refreshes `updated_at`, so the stale rule only catches runs whose Workflow is gone.
		const entered = await step.do("enter", () => enterQueue(db, candidateId, Date.now(), run));
		// The candidate was deleted, or its run dropped, before its run began.
		if (!entered) return;

		let slot: SlotResult = "waiting";
		for (let poll = 0; poll < QUEUE_MAX_POLLS && slot === "waiting"; poll++) {
			slot = await step.do(`slot-${poll}`, () => takeSlot(db, candidateId, Date.now(), run));
			if (slot === "waiting") await step.sleep(`wait-${poll}`, QUEUE_POLL);
		}
		if (slot === "gone") return;
		if (slot === "waiting") throw new QueueTimeoutError("No reading slot came free");

		const scored = await step.do("score", GEMINI_STEP, async () => {
			try {
				return await scoreCandidate(db, bucket, scorer, candidateId, mode);
			} catch (error) {
				if (error instanceof PermanentScoringError) throw nonRetryable(error.message);
				throw error;
			}
		});
		// The candidate was deleted while its run was under way.
		if (!scored) return;

		await step.do("save", async () => {
			await saveScore(db, candidateId, scored, mode);
			return true;
		});
	} catch (error) {
		console.error(`[${candidateId}] ${run === "check" ? "checking" : "scoring"} failed`, error);
		await step.do("fail", async () => {
			if (run === "check") await endCheck(db, candidateId);
			else await markFailed(db, candidateId, failureMessage(error));
			return true;
		});
		// Leaves the instance errored in the dashboard, though the recruiter already sees the failure.
		throw error;
	}
}
