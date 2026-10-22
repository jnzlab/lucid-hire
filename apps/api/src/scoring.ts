import { eq } from "drizzle-orm";
import { recordAiUsage } from "./ai.ts";
import { computeScore } from "./candidates.ts";
import { type CvScore, type CvScorer, isUnreadableFileError } from "./cv-scorer.ts";
import type { Db } from "./db/client.ts";
import { candidates, jobs } from "./db/schema.ts";

// The logic behind each step of ScoreCvWorkflow, as plain functions so tests can run them without the
// Workers runtime. The Workflow class only wires them to steps.

export const CV_SCORE_OPERATION = "cv_score";
export const UNREADABLE_MESSAGE = "We couldn't read this file as a CV.";
export const SCORING_FAILED_MESSAGE = "Scoring failed. Try again.";

// A failure that retrying can't fix. The Workflow turns it into a NonRetryableError.
export class PermanentScoringError extends Error {}

// What the "score" step returns to the Workflow: small JSON, well under the 1 MiB step limit.
export type ScoreStepOutput = {
	result: CvScore;
	usage: { inputTokens: number | null; outputTokens: number | null };
};

// False when the candidate was deleted before its run started, so the Workflow can stop quietly.
export async function markScoring(db: Db, candidateId: string): Promise<boolean> {
	const updated = await db
		.update(candidates)
		.set({ status: "scoring" })
		.where(eq(candidates.id, candidateId))
		.returning({ id: candidates.id });
	return updated.length > 0;
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
			name: result.name || null,
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
	return permanent ? UNREADABLE_MESSAGE : SCORING_FAILED_MESSAGE;
}

// The usage rows for failed Gemini calls are written where the calls happen (see scoreCandidate), not here.
export async function markFailed(db: Db, candidateId: string, message: string): Promise<void> {
	await db.update(candidates).set({ status: "failed", error: message }).where(eq(candidates.id, candidateId));
}
