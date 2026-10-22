import { eq, sql } from "drizzle-orm";
import { COMPANY_SCORING_CAP, PLANS } from "@lucid-hire/plans";
import { recordAiUsage } from "./ai.ts";
import { STALE_SCORING_MS, computeScore } from "./candidates.ts";
import { GLOBAL_SCORING_CAP } from "./config.ts";
import { type CvScore, type CvScorer, isUnreadableFileError } from "./cv-scorer.ts";
import type { Db } from "./db/client.ts";
import { candidates, jobs, organizations } from "./db/schema.ts";
import { effectivePlanSql } from "./plan-state.ts";

// The logic behind each step of ScoreCvWorkflow, as plain functions so tests can run them without the
// Workers runtime. The Workflow class only wires them to steps.

export const CV_SCORE_OPERATION = "cv_score";
export const UNREADABLE_MESSAGE = "We couldn't read this file as a CV.";
export const SCORING_FAILED_MESSAGE = "Scoring failed. Try again.";
export const QUEUE_FULL_MESSAGE = "The reading queue is full. Try again in a few minutes.";

// A failure that retrying can't fix. The Workflow turns it into a NonRetryableError.
export class PermanentScoringError extends Error {}

// No slot came free within the wait limit. Retrying later usually works.
export class QueueTimeoutError extends Error {}

// What the "score" step returns to the Workflow: small JSON, well under the 1 MiB step limit.
export type ScoreStepOutput = {
	result: CvScore;
	usage: { inputTokens: number | null; outputTokens: number | null };
};

// How long a waiting CV vouches for its place in the queue: a waiter that hasn't refreshed `updated_at` this
// recently is a dead Workflow, and must not hold anyone up.
export const WAITER_LIVE_MS = 60 * 1000;

// Begins a CV's run: its place in the queue is the time now, minus the head start of its company's plan. Each run
// is a new Workflow instance, so a retry gets a fresh place. False when the candidate was deleted.
export async function enterQueue(db: Db, candidateId: string, now: number = Date.now()): Promise<boolean> {
	const headStartMs = sql`(SELECT CASE ${effectivePlanSql(now)}
		WHEN 'max' THEN ${PLANS.max.queueHeadStartSec * 1000} WHEN 'pro' THEN ${PLANS.pro.queueHeadStartSec * 1000}
		ELSE ${PLANS.free.queueHeadStartSec * 1000} END FROM ${organizations} WHERE ${organizations.id} = candidates.org_id)`;
	const updated = await db.all<{ id: string }>(sql`UPDATE candidates
		SET queue_priority_at = ${now} - COALESCE(${headStartMs}, 0), updated_at = ${now}
		WHERE id = ${candidateId} AND status IN ('queued', 'scoring')
		RETURNING id`);
	return updated.length > 0;
}

export type SlotResult = "started" | "waiting" | "gone";

// Takes a reading slot in ONE guarded UPDATE (queued -> scoring), so two Workflows can't both take the last one:
// the company has fewer than COMPANY_SCORING_CAP CVs scoring, fewer than GLOBAL_SCORING_CAP overall, and no other
// live waiter is ahead of this CV while its own company still has room. Scoring rows that went stale are dead
// Workflows and hold no slot. A CV that has to wait gets a heartbeat instead, so the stale rule never fails it.
export async function takeSlot(db: Db, candidateId: string, now: number = Date.now()): Promise<SlotResult> {
	const staleBefore = now - STALE_SCORING_MS;
	const liveAfter = now - WAITER_LIVE_MS;
	const priority = (alias: string) => sql.raw(`COALESCE(${alias}.queue_priority_at, ${alias}.created_at)`);
	const reading = (alias: string) => sql`${sql.raw(alias)}.status = 'scoring' AND ${sql.raw(alias)}.updated_at > ${staleBefore}`;

	// "Scoring" counts exclude this CV: a retried step finds it already scoring and must not count itself.
	const started = await db.all<{ id: string }>(sql`UPDATE candidates
		SET status = 'scoring', updated_at = ${now}
		WHERE id = ${candidateId} AND status IN ('queued', 'scoring')
		AND (SELECT count(*) FROM candidates s WHERE s.org_id = candidates.org_id AND s.id != candidates.id
			AND ${reading("s")}) < ${COMPANY_SCORING_CAP}
		AND (SELECT count(*) FROM candidates s WHERE s.id != candidates.id AND ${reading("s")}) < ${GLOBAL_SCORING_CAP}
		AND NOT EXISTS (
			SELECT 1 FROM candidates w
			WHERE w.status = 'queued' AND w.id != candidates.id AND w.updated_at > ${liveAfter}
			AND (${priority("w")} < ${priority("candidates")}
				OR (${priority("w")} = ${priority("candidates")} AND w.id < candidates.id))
			AND (SELECT count(*) FROM candidates s WHERE s.org_id = w.org_id AND ${reading("s")}) < ${COMPANY_SCORING_CAP}
		)
		RETURNING id`);
	if (started.length > 0) return "started";

	const waiting = await db.all<{ id: string }>(sql`UPDATE candidates SET updated_at = ${now}
		WHERE id = ${candidateId} AND status = 'queued'
		RETURNING id`);
	return waiting.length > 0 ? "waiting" : "gone";
}

export async function scoreCandidate(
	db: Db,
	bucket: R2Bucket,
	scorer: CvScorer,
	candidateId: string,
): Promise<ScoreStepOutput | null> {
	const [row] = await db
		.select({
			fileKey: candidates.fileKey,
			orgId: candidates.orgId,
			createdBy: candidates.createdBy,
			jobId: candidates.jobId,
			title: jobs.title,
			description: jobs.description,
		})
		.from(candidates)
		.innerJoin(jobs, eq(jobs.id, candidates.jobId))
		.where(eq(candidates.id, candidateId))
		.limit(1);
	// Null when the candidate was deleted during the run, so the Workflow can stop quietly.
	if (!row) return null;

	const object = await bucket.get(row.fileKey);
	if (!object) throw new PermanentScoringError("The uploaded file is missing");
	// A native copy of at most 5 MB: no parsing, no base64.
	const pdf = new Uint8Array(await object.arrayBuffer());

	try {
		const { value, inputTokens, outputTokens } = await scorer({
			jobTitle: row.title,
			jobDescription: row.description,
			pdf,
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

export async function saveScore(db: Db, candidateId: string, { result, usage }: ScoreStepOutput): Promise<void> {
	const [row] = await db
		.update(candidates)
		.set({
			status: "scored",
			error: null,
			// A name the recruiter gave at upload stays; the CV's own name fills in only when there is none.
			name: sql`coalesce(${candidates.name}, ${result.name || null})`,
			headline: result.headline || null,
			summary: result.summary,
			requirements: result.requirements,
			profile: result.profile,
			score: computeScore(result.requirements),
			scoredAt: new Date(),
		})
		.where(eq(candidates.id, candidateId))
		.returning({ orgId: candidates.orgId, jobId: candidates.jobId, createdBy: candidates.createdBy });
	// No row means the candidate was deleted while Gemini was working, and there is nobody to bill.
	if (!row) return;

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
	return permanent ? UNREADABLE_MESSAGE : SCORING_FAILED_MESSAGE;
}

// The usage rows for failed Gemini calls are written where the calls happen (see scoreCandidate), not here.
export async function markFailed(db: Db, candidateId: string, message: string): Promise<void> {
	await db.update(candidates).set({ status: "failed", error: message }).where(eq(candidates.id, candidateId));
}
