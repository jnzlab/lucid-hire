import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { type CandidateStatus, type Requirement, candidates, jobs } from "./db/schema.ts";
import { inOrg } from "./jobs.ts";

// The landing page promises "Free for 10 CVs a job".
export const CV_LIMIT_PER_JOB = 10;
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_FILE_NAME_MAX = 200;
export const DEFAULT_CV_FILE_NAME = "cv.pdf";
// The first run plus up to two manual retries.
export const MAX_SCORING_RUNS = 3;
// A run is stuck when the CV is still queued or scoring this long after its last update: a worst-case run
// (4 Gemini attempts plus their backoff) takes about 15 minutes, so the Workflow is gone or its "fail" step gave up.
export const STALE_SCORING_MS = 20 * 60 * 1000;
// R2 deletes up to 1000 keys per call.
const R2_DELETE_BATCH = 1000;

export const START_FAILED_MESSAGE = "We couldn't start scoring this CV. Try again.";

export type CandidateSummary = {
	id: string;
	fileName: string;
	status: CandidateStatus;
	name: string | null;
	headline: string | null;
	score: number | null;
	// Labels of met requirements (must-haves first, at most 4) and of unmet must-haves (at most 2).
	matches: string[];
	gaps: string[];
	error: string | null;
	canRetry: boolean;
	createdAt: Date;
	// Changes with every status change, so the page can tell how long the current run has taken.
	updatedAt: Date;
	scoredAt: Date | null;
};
export type Candidate = CandidateSummary & {
	summary: string | null;
	requirements: Requirement[] | null;
	fileSize: number;
};

const summaryColumns = {
	id: candidates.id,
	fileName: candidates.fileName,
	status: candidates.status,
	name: candidates.name,
	headline: candidates.headline,
	score: candidates.score,
	requirements: candidates.requirements,
	runs: candidates.runs,
	error: candidates.error,
	createdAt: candidates.createdAt,
	updatedAt: candidates.updatedAt,
	scoredAt: candidates.scoredAt,
};
const candidateColumns = { ...summaryColumns, summary: candidates.summary, fileSize: candidates.fileSize };

type SummaryRow = Pick<typeof candidates.$inferSelect, keyof typeof summaryColumns>;
type CandidateRow = Pick<typeof candidates.$inferSelect, keyof typeof candidateColumns>;

const isMust = (r: Requirement) => Number(r.importance === "must");
const mustFirst = (a: Requirement, b: Requirement) => isMust(b) - isMust(a);

// A failed CV can be retried, and so can one stuck in queued or scoring; fresh ones are still being worked on.
function isRetryable(status: CandidateStatus, updatedAt: Date): boolean {
	const stuck = (status === "queued" || status === "scoring") && Date.now() - updatedAt.getTime() > STALE_SCORING_MS;
	return status === "failed" || stuck;
}

function toSummary(row: SummaryRow): CandidateSummary {
	const requirements = row.requirements ?? [];
	return {
		id: row.id,
		fileName: row.fileName,
		status: row.status,
		name: row.name,
		headline: row.headline,
		score: row.score,
		matches: requirements
			.filter((r) => r.met)
			.sort(mustFirst)
			.slice(0, 4)
			.map((r) => r.label),
		gaps: requirements
			.filter((r) => r.importance === "must" && !r.met)
			.slice(0, 2)
			.map((r) => r.label),
		error: row.error,
		canRetry: isRetryable(row.status, row.updatedAt) && row.runs < MAX_SCORING_RUNS,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		scoredAt: row.scoredAt,
	};
}

const toCandidate = (row: CandidateRow): Candidate => ({
	...toSummary(row),
	summary: row.summary,
	requirements: row.requirements,
	fileSize: row.fileSize,
});

// The score is ours, not the model's: must-haves count double, so it is deterministic and explainable.
export function computeScore(requirements: Requirement[]): number {
	let earned = 0;
	let total = 0;
	for (const { importance, met } of requirements) {
		const weight = importance === "must" ? 2 : 1;
		total += weight;
		if (met) earned += weight;
	}
	return total === 0 ? 0 : Math.round((100 * earned) / total);
}

// Every candidate query is scoped to the company and the job in the URL.
const inJob = (orgId: string, jobId: string) => and(eq(candidates.orgId, orgId), eq(candidates.jobId, jobId));
const inJobById = (orgId: string, jobId: string, id: string) => and(inJob(orgId, jobId), eq(candidates.id, id));

// The job's CV count, or null when the job isn't the company's.
export async function getCvCount(db: Db, orgId: string, jobId: string): Promise<number | null> {
	const [job] = await db.select({ cvCount: jobs.cvCount }).from(jobs).where(inOrg(orgId, jobId)).limit(1);
	return job?.cvCount ?? null;
}

// Scored by score (ties: scored first), then CVs still being read, then failed ones.
export async function listCandidates(db: Db, orgId: string, jobId: string): Promise<CandidateSummary[]> {
	const rows = await db
		.select(summaryColumns)
		.from(candidates)
		.where(inJob(orgId, jobId))
		.orderBy(
			sql`case ${candidates.status} when 'scored' then 0 when 'failed' then 2 else 1 end`,
			desc(candidates.score),
			asc(candidates.scoredAt),
			asc(candidates.createdAt),
		);
	return rows.map(toSummary);
}

export async function getCandidate(db: Db, orgId: string, jobId: string, id: string): Promise<Candidate | null> {
	const [row] = await db.select(candidateColumns).from(candidates).where(inJobById(orgId, jobId, id)).limit(1);
	return row ? toCandidate(row) : null;
}

export type SlotResult = { ok: true } | { ok: false; reason: "job_not_found" | "job_not_open" | "cv_limit" };

// Takes one of the job's CV slots in a single statement, so two uploads racing each other can't pass
// the limit. `updated_at` is left alone: a new CV isn't an edit to the job.
export async function takeSlot(db: Db, orgId: string, jobId: string): Promise<SlotResult> {
	const [taken] = await db
		.update(jobs)
		.set({ cvCount: sql`${jobs.cvCount} + 1`, updatedAt: sql`${jobs.updatedAt}` })
		.where(and(inOrg(orgId, jobId), eq(jobs.status, "open"), lt(jobs.cvCount, CV_LIMIT_PER_JOB)))
		.returning({ cvCount: jobs.cvCount });
	if (taken) return { ok: true };

	const [job] = await db.select({ status: jobs.status }).from(jobs).where(inOrg(orgId, jobId)).limit(1);
	if (!job) return { ok: false, reason: "job_not_found" };
	return { ok: false, reason: job.status === "open" ? "cv_limit" : "job_not_open" };
}

// Gives the slot back when the upload never made it into R2. Called through waitUntil, so a cancelled request
// still releases it, and it never throws.
export async function releaseSlot(db: Db, orgId: string, jobId: string): Promise<void> {
	try {
		await db
			.update(jobs)
			.set({ cvCount: sql`max(${jobs.cvCount} - 1, 0)`, updatedAt: sql`${jobs.updatedAt}` })
			.where(inOrg(orgId, jobId));
	} catch (error) {
		console.error("cv slot not released", error);
	}
}

type NewCandidate = {
	id: string;
	orgId: string;
	jobId: string;
	fileKey: string;
	fileName: string;
	fileSize: number;
	createdBy: string;
};

export async function createCandidate(db: Db, input: NewCandidate): Promise<Candidate> {
	const [row] = await db.insert(candidates).values(input).returning(candidateColumns);
	return toCandidate(row);
}

// For a scoring run that could not be started at all, so the CV doesn't sit queued forever.
export async function markStartFailed(db: Db, id: string): Promise<Candidate | null> {
	const [row] = await db
		.update(candidates)
		.set({ status: "failed", error: START_FAILED_MESSAGE })
		.where(and(eq(candidates.id, id), eq(candidates.status, "queued")))
		.returning(candidateColumns);
	return row ? toCandidate(row) : null;
}

export type RetryResult =
	| { ok: true; candidate: Candidate; runs: number }
	| { ok: false; reason: "candidate_not_found" | "not_failed" | "retry_limit" };

// Queues another scoring run for a failed or stuck CV, in one statement so a double click can't start two.
export async function startRetry(db: Db, orgId: string, jobId: string, id: string): Promise<RetryResult> {
	const staleBefore = new Date(Date.now() - STALE_SCORING_MS);
	const [row] = await db
		.update(candidates)
		.set({ runs: sql`${candidates.runs} + 1`, status: "queued", error: null })
		.where(
			and(
				inJobById(orgId, jobId, id),
				or(
					eq(candidates.status, "failed"),
					and(inArray(candidates.status, ["queued", "scoring"]), lt(candidates.updatedAt, staleBefore)),
				),
				lt(candidates.runs, MAX_SCORING_RUNS),
			),
		)
		.returning(candidateColumns);
	if (row) return { ok: true, candidate: toCandidate(row), runs: row.runs };

	const [current] = await db
		.select({ status: candidates.status, updatedAt: candidates.updatedAt })
		.from(candidates)
		.where(inJobById(orgId, jobId, id))
		.limit(1);
	if (!current) return { ok: false, reason: "candidate_not_found" };
	return { ok: false, reason: isRetryable(current.status, current.updatedAt) ? "retry_limit" : "not_failed" };
}

// Returns the deleted CV's R2 key, or null when it isn't the company's. The job keeps the slot it used.
export async function deleteCandidate(db: Db, orgId: string, jobId: string, id: string): Promise<string | null> {
	const [row] = await db
		.delete(candidates)
		.where(inJobById(orgId, jobId, id))
		.returning({ fileKey: candidates.fileKey });
	return row?.fileKey ?? null;
}

export async function listFileKeys(db: Db, orgId: string, jobId: string): Promise<string[]> {
	const rows = await db.select({ fileKey: candidates.fileKey }).from(candidates).where(inJob(orgId, jobId));
	return rows.map((row) => row.fileKey);
}

// Called through waitUntil after the response, so it never throws.
export async function deleteCvFiles(bucket: R2Bucket, keys: string[]): Promise<void> {
	try {
		for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) await bucket.delete(keys.slice(i, i + R2_DELETE_BATCH));
	} catch (error) {
		console.error("cv files not deleted", error);
	}
}
