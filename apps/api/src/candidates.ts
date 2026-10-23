import { type SQL, and, asc, desc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Db } from "./db/client.ts";
import {
	CANDIDATE_DECISIONS,
	type CandidateProfile,
	type CandidateStatus,
	type Decision,
	type Requirement,
	candidates,
	jobs,
} from "./db/schema.ts";
import type { ExportRow } from "./candidates-export.ts";
import { inOrg } from "./jobs.ts";
import { limitSql } from "./plan-state.ts";

export { CANDIDATE_DECISIONS, type Decision };

export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_FILE_NAME_MAX = 200;
export const DEFAULT_CV_FILE_NAME = "cv.pdf";
export const NOTE_MAX = 1000;
// The longest name a recruiter can give a CV.
export const APPLICANT_NAME_MAX = 120;
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
	// The recruiters' call on this CV, whatever its status.
	decision: Decision;
	name: string | null;
	headline: string | null;
	score: number | null;
	// Place among the job's scored CVs (1 is best), or null while the CV has no score. The list, the candidate page
	// and the CSV export all take it from rankOrder.
	rank: number | null;
	// Labels of met requirements (must-haves first, at most 4) and of unmet must-haves (at most 2).
	matches: string[];
	gaps: string[];
	// Every requirement of the job with whether the CV met it, for the row's "show all requirements".
	checks: { label: string; met: boolean; importance: "must" | "nice" }[];
	// The AI's two sentences on the fit, so the list can be searched by them.
	summary: string | null;
	// Whether a recruiter has written a note. The note itself stays on the candidate.
	hasNote: boolean;
	// Where the CV came from: a recruiter's upload, or the applicant through the job's public page.
	source: "upload" | "apply";
	// The address the applicant gave when applying, else the one on the CV. The list shows and searches it.
	email: string | null;
	// Just the email from the CV; the rest of the profile is on the candidate.
	profile: { email?: string } | null;
	error: string | null;
	canRetry: boolean;
	createdAt: Date;
	// Changes with every status change, so the page can tell how long the current run has taken.
	updatedAt: Date;
	scoredAt: Date | null;
};
export type Candidate = Omit<CandidateSummary, "profile"> & {
	// How many CVs of the job are ranked, for "#2 of 7".
	rankedCount: number;
	requirements: Requirement[] | null;
	// What the CV states about the candidate. Null for a CV that hasn't been read.
	profile: CandidateProfile | null;
	fileSize: number;
	note: string | null;
	// When the decision last changed, and the Clerk user who changed it. Null while it is undecided.
	decidedAt: Date | null;
	decidedBy: string | null;
};

// The address the applicant gave when applying, else the one on the CV. Lists show and search it.
export const candidateEmailSql = sql<string | null>`coalesce(${candidates.email}, json_extract(${candidates.profile}, '$.email'))`;

const summaryColumns = {
	id: candidates.id,
	fileName: candidates.fileName,
	status: candidates.status,
	decision: candidates.decision,
	name: candidates.name,
	headline: candidates.headline,
	score: candidates.score,
	requirements: candidates.requirements,
	summary: candidates.summary,
	hasNote: sql<number>`${candidates.note} is not null`,
	source: candidates.source,
	email: candidateEmailSql,
	cvEmail: sql<string | null>`json_extract(${candidates.profile}, '$.email')`,
	runs: candidates.runs,
	error: candidates.error,
	createdAt: candidates.createdAt,
	updatedAt: candidates.updatedAt,
	scoredAt: candidates.scoredAt,
};
const candidateColumns = {
	...summaryColumns,
	profile: candidates.profile,
	fileSize: candidates.fileSize,
	note: candidates.note,
	decidedAt: candidates.decidedAt,
	decidedBy: candidates.decidedBy,
};

// What the select returns: the table's columns, plus the two computed ones.
type SummaryRow = Pick<typeof candidates.$inferSelect, Exclude<keyof typeof summaryColumns, "hasNote" | "email" | "cvEmail">> & {
	hasNote: number;
	email: string | null;
	cvEmail: string | null;
};
type CandidateRow = SummaryRow & Pick<typeof candidates.$inferSelect, "profile" | "fileSize" | "note" | "decidedAt" | "decidedBy">;

const isMust = (r: Requirement) => Number(r.importance === "must");
const mustFirst = (a: Requirement, b: Requirement) => isMust(b) - isMust(a);

// A failed CV can be retried, and so can one stuck in queued or scoring; fresh ones are still being worked on.
function isRetryable(status: CandidateStatus, updatedAt: Date): boolean {
	const stuck = (status === "queued" || status === "scoring") && Date.now() - updatedAt.getTime() > STALE_SCORING_MS;
	return status === "failed" || stuck;
}

function toSummary(row: SummaryRow, rank: number | null = null): CandidateSummary {
	const requirements = row.requirements ?? [];
	return {
		id: row.id,
		fileName: row.fileName,
		status: row.status,
		decision: row.decision,
		name: row.name,
		headline: row.headline,
		score: row.score,
		rank,
		matches: requirements
			.filter((r) => r.met)
			.sort(mustFirst)
			.slice(0, 4)
			.map((r) => r.label),
		gaps: requirements
			.filter((r) => r.importance === "must" && !r.met)
			.slice(0, 2)
			.map((r) => r.label),
		checks: requirements.map(({ label, met, importance }) => ({ label, met, importance })),
		summary: row.summary,
		hasNote: Boolean(row.hasNote),
		source: row.source,
		email: row.email,
		profile: row.cvEmail ? { email: row.cvEmail } : null,
		error: row.error,
		canRetry: isRetryable(row.status, row.updatedAt) && row.runs < MAX_SCORING_RUNS,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		scoredAt: row.scoredAt,
	};
}

const toCandidate = (row: CandidateRow, rank: number | null = null, rankedCount = 0): Candidate => ({
	...toSummary(row, rank),
	rankedCount,
	requirements: row.requirements,
	profile: row.profile,
	fileSize: row.fileSize,
	note: row.note,
	decidedAt: row.decidedAt,
	decidedBy: row.decidedBy,
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

// THE ranking, used by the list, the candidate page and the CSV export so their ranks agree: higher score first,
// then whoever was scored first, then whoever uploaded first, then the id so that two rows never tie.
const rankOrder = [desc(candidates.score), asc(candidates.scoredAt), asc(candidates.createdAt), asc(candidates.id)];
// Only a CV that has been scored has a rank.
const isRanked = and(eq(candidates.status, "scored"), isNotNull(candidates.score));

// The job's ranked CVs, best first.
async function rankedIds(db: Db, orgId: string, jobId: string): Promise<string[]> {
	const rows = await db
		.select({ id: candidates.id })
		.from(candidates)
		.where(and(inJob(orgId, jobId), isRanked))
		.orderBy(...rankOrder);
	return rows.map(({ id }) => id);
}

// A timestamp_ms column as Date.toJSON() writes it, e.g. "2026-10-22T21:49:06.612Z", or null.
const isoSql = (column: SQLiteColumn) => sql`(strftime('%Y-%m-%dT%H:%M:%S', CAST(${column} AS INTEGER) / 1000, 'unixepoch')
	|| '.' || printf('%03d', CAST(${column} AS INTEGER) % 1000) || 'Z')`;
const jsonBool = (condition: SQL) => sql`json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;
const met = sql`coalesce(json_extract(r.value, '$.met'), 0)`;
const isMustSql = sql`(json_extract(r.value, '$.importance') = 'must')`;

// One CandidateSummary (what toSummary() makes) as JSON, built by SQLite. A Max job holds 1,000 CVs, and parsing
// every CV's requirements on the Worker and writing the list back out costs far more than its 10 ms of CPU.
const summaryJsonSql = (now: number) => sql`json_object(
	'id', ${candidates.id}, 'fileName', ${candidates.fileName}, 'status', ${candidates.status},
	'decision', ${candidates.decision}, 'name', ${candidates.name}, 'headline', ${candidates.headline},
	'score', ${candidates.score},
	'rank', CASE WHEN ${candidates.status} = 'scored' AND ${candidates.score} IS NOT NULL THEN row_number() OVER (
		PARTITION BY ${candidates.status} = 'scored' AND ${candidates.score} IS NOT NULL
		ORDER BY ${candidates.score} DESC, ${candidates.scoredAt}, ${candidates.createdAt}, ${candidates.id}) END,
	'matches', json((SELECT json_group_array(label ORDER BY must DESC, k) FROM (
		SELECT json_extract(r.value, '$.label') AS label, ${isMustSql} AS must, r.key AS k
		FROM json_each(${candidates.requirements}) r WHERE ${met} ORDER BY must DESC, k LIMIT 4))),
	'gaps', json((SELECT json_group_array(label ORDER BY k) FROM (
		SELECT json_extract(r.value, '$.label') AS label, r.key AS k
		FROM json_each(${candidates.requirements}) r WHERE ${isMustSql} AND NOT ${met} ORDER BY k LIMIT 2))),
	'checks', json((SELECT json_group_array(json_object(
			'label', json_extract(r.value, '$.label'), 'met', ${jsonBool(met)},
			'importance', json_extract(r.value, '$.importance')) ORDER BY r.key)
		FROM json_each(${candidates.requirements}) r)),
	'summary', ${candidates.summary}, 'hasNote', ${jsonBool(sql`${candidates.note} IS NOT NULL`)},
	'source', ${candidates.source}, 'email', ${summaryColumns.email},
	'profile', CASE WHEN nullif(${summaryColumns.cvEmail}, '') IS NOT NULL THEN json_object('email', ${summaryColumns.cvEmail}) END,
	'error', ${candidates.error},
	'canRetry', ${jsonBool(sql`(${candidates.status} = 'failed' OR (${candidates.status} IN ('queued', 'scoring')
		AND ${now} - ${candidates.updatedAt} > ${STALE_SCORING_MS})) AND ${candidates.runs} < ${MAX_SCORING_RUNS}`)},
	'createdAt', ${isoSql(candidates.createdAt)}, 'updatedAt', ${isoSql(candidates.updatedAt)},
	'scoredAt', ${isoSql(candidates.scoredAt)})`;

// The job's CandidateSummary list as a JSON array, ready to send: scored by rank, then CVs still being read, then
// failed ones. Ranks are counted over the whole job, so they don't depend on what the list shows. The Worker only
// joins the rows SQLite wrote.
export async function listCandidatesJson(db: Db, orgId: string, jobId: string, now: number = Date.now()): Promise<string> {
	const rows = await db
		.select({ json: sql<string>`${summaryJsonSql(now)}` })
		.from(candidates)
		.where(inJob(orgId, jobId))
		.orderBy(sql`case ${candidates.status} when 'scored' then 0 when 'failed' then 2 else 1 end`, ...rankOrder);
	return `[${rows.map(({ json }) => json).join(",")}]`;
}

// The candidate with its place among the job's scored CVs.
async function ranked(db: Db, orgId: string, jobId: string, row: CandidateRow): Promise<Candidate> {
	if (row.status !== "scored" || row.score === null) return toCandidate(row);
	const ids = await rankedIds(db, orgId, jobId);
	const index = ids.indexOf(row.id);
	return toCandidate(row, index === -1 ? null : index + 1, ids.length);
}

// Everything the CSV export holds, ranked as the list is. Ranks count the whole job, so they don't change with the
// decision filter.
export async function listForExport(
	db: Db,
	orgId: string,
	jobId: string,
	decision: Decision | "all",
): Promise<ExportRow[]> {
	const labels = (which: SQL) => sql<string | null>`(SELECT group_concat(json_extract(r.value, '$.label'), '; ' ORDER BY r.key)
		FROM json_each(${candidates.requirements}) r WHERE ${which})`;
	const rows = await db
		.select({
			name: candidates.name,
			fileName: candidates.fileName,
			email: summaryColumns.email,
			phone: sql<string | null>`json_extract(${candidates.profile}, '$.phone')`,
			score: candidates.score,
			status: candidates.status,
			decision: candidates.decision,
			note: candidates.note,
			decidedAt: candidates.decidedAt,
			createdAt: candidates.createdAt,
			summary: candidates.summary,
			matching: labels(met),
			missing: labels(sql`NOT ${met}`),
			error: candidates.error,
		})
		.from(candidates)
		.where(inJob(orgId, jobId))
		.orderBy(sql`case ${candidates.status} when 'scored' then 0 when 'failed' then 2 else 1 end`, ...rankOrder);
	let rank = 0;
	return rows
		.map((row) => ({ ...row, rank: row.status === "scored" && row.score !== null ? ++rank : null }))
		.filter((row) => decision === "all" || row.decision === decision);
}

export async function getCandidate(db: Db, orgId: string, jobId: string, id: string): Promise<Candidate | null> {
	const [row] = await db.select(candidateColumns).from(candidates).where(inJobById(orgId, jobId, id)).limit(1);
	return row ? ranked(db, orgId, jobId, row) : null;
}

export type SlotResult = { ok: true } | { ok: false; reason: "job_not_found" | "job_not_open" | "cv_limit" };

// Takes one of the job's CV slots in a single statement, so two uploads racing each other can't pass
// the limit. The limit is the company's effective plan, looked up by a subquery in the same statement.
// `updated_at` is left alone: a new CV isn't an edit to the job.
export async function takeSlot(db: Db, orgId: string, jobId: string): Promise<SlotResult> {
	const [taken] = await db
		.update(jobs)
		.set({ cvCount: sql`${jobs.cvCount} + 1`, updatedAt: sql`${jobs.updatedAt}` })
		.where(and(inOrg(orgId, jobId), eq(jobs.status, "open"), lt(jobs.cvCount, limitSql(orgId, (plan) => plan.cvsPerJob))))
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

// The name a recruiter typed for a CV, sent URI-encoded in a header so names with accents or other scripts survive.
// Blank is none (null); undefined means the header was malformed or too long.
export function parseApplicantName(raw: string | undefined): string | null | undefined {
	if (raw === undefined) return null;
	let name: string;
	try {
		name = decodeURIComponent(raw).trim().replace(/\s+/gu, " ");
	} catch {
		return undefined;
	}
	if (!name) return null;
	return name.length > APPLICANT_NAME_MAX ? undefined : name;
}

type NewCandidate = {
	id: string;
	orgId: string;
	jobId: string;
	fileKey: string;
	fileName: string;
	fileSize: number;
	createdBy: string;
	// Set for applications from the public page; recruiter uploads leave both out.
	source?: "upload" | "apply";
	email?: string;
	// What a recruiter typed for a CV; scoring never replaces it with the name read from the CV.
	name?: string;
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

const noteInput = z
	.string({ error: "Write the note as text" })
	.trim()
	.max(NOTE_MAX, { error: `Keep the note to ${NOTE_MAX} characters or fewer` })
	// A cleared note is stored as null, not as an empty string.
	.transform((value) => value || null);

export const decideInput = z
	.object({
		decision: z.enum(CANDIDATE_DECISIONS, { error: "Choose undecided, shortlisted or rejected" }).optional(),
		note: noteInput.nullable().optional(),
	})
	.refine((patch) => Object.values(patch).some((value) => value !== undefined), { error: "Nothing to update" });

// The column as it is while the row already has this decision, otherwise `fresh`. SQLite reads every value in an
// UPDATE from the old row, so this is the decision before the change.
const unlessSame = (decision: Decision, column: SQLiteColumn, fresh: number | string) =>
	sql`case when ${candidates.decision} = ${decision} then ${column} else ${fresh} end`;

// Records a recruiter's decision and note. Any status can be decided, so a CV that failed can be rejected.
// `decided_at` and `decided_by` change only when the decision itself does, and are cleared when it goes back to
// undecided. That is one statement, so two recruiters deciding at once can't mix their name with the other's time.
// `updated_at` stays put: it times scoring runs.
export async function decideCandidate(
	db: Db,
	orgId: string,
	jobId: string,
	id: string,
	userId: string,
	{ decision, note }: z.output<typeof decideInput>,
): Promise<Candidate | null> {
	const [row] = await db
		.update(candidates)
		.set({
			...(note !== undefined && { note }),
			...(decision !== undefined && {
				decision,
				decidedAt: decision === "undecided" ? null : unlessSame(decision, candidates.decidedAt, Date.now()),
				decidedBy: decision === "undecided" ? null : unlessSame(decision, candidates.decidedBy, userId),
			}),
			updatedAt: sql`${candidates.updatedAt}`,
		})
		.where(inJobById(orgId, jobId, id))
		.returning(candidateColumns);
	return row ? ranked(db, orgId, jobId, row) : null;
}

// The most CVs one bulk action takes: a page of the candidates list is 50, a job's list can be selected whole.
export const BULK_MAX = 200;
const BULK_HINT = `Choose between 1 and ${BULK_MAX} candidates`;

const bulkIds = z
	.array(z.string({ error: "Send each candidate's id as text" }).min(1).max(100), { error: BULK_HINT })
	.min(1, { error: BULK_HINT })
	.max(BULK_MAX, { error: BULK_HINT })
	.refine((ids) => new Set(ids).size === ids.length, { error: "List each candidate only once" });

export const bulkDecideInput = z.object({
	ids: bulkIds,
	decision: z.enum(CANDIDATE_DECISIONS, { error: "Choose undecided, shortlisted or rejected" }),
});
export const bulkDeleteInput = z.object({ ids: bulkIds });

// The company's candidates among `ids`. The ids travel as one JSON parameter, because D1 binds at most 100 values a
// statement and a bulk action can send 200. Ids from another company, or that don't exist, simply match nothing.
const inOrgByIds = (orgId: string, ids: string[]) =>
	and(eq(candidates.orgId, orgId), sql`${candidates.id} in (select value from json_each(${JSON.stringify(ids)}))`);

export type BulkDecided = { id: string; jobId: string; decision: Decision; previous: Decision };

// One decision for many CVs, across jobs, by the single PATCH's rules: `decided_at` and `decided_by` are set (or
// cleared on undecided) only where the decision changes, and `updated_at` stays put. Rows that already have the
// decision are left alone and not returned, so what comes back is exactly what an undo has to put back. The read of the
// old decisions and the update share one batch, which D1 runs as a transaction.
export async function decideCandidates(
	db: Db,
	orgId: string,
	ids: string[],
	userId: string,
	decision: Decision,
): Promise<BulkDecided[]> {
	const changing = and(inOrgByIds(orgId, ids), ne(candidates.decision, decision));
	const [before, after] = await db.batch([
		db.select({ id: candidates.id, previous: candidates.decision }).from(candidates).where(changing),
		db
			.update(candidates)
			.set({
				decision,
				decidedAt: decision === "undecided" ? null : new Date(),
				decidedBy: decision === "undecided" ? null : userId,
				updatedAt: sql`${candidates.updatedAt}`,
			})
			.where(changing)
			.returning({ id: candidates.id, jobId: candidates.jobId, decision: candidates.decision }),
	]);
	const previous = new Map(before.map((row) => [row.id, row.previous]));
	const order = new Map(ids.map((id, index) => [id, index]));
	return after
		.map((row) => ({ ...row, previous: previous.get(row.id) ?? row.decision }))
		.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// Deletes the company's CVs among `ids` and returns them with their R2 keys, for the caller to remove the files. Their
// jobs keep the slots they used, as with a single delete.
export async function deleteCandidates(
	db: Db,
	orgId: string,
	ids: string[],
): Promise<Array<{ id: string; jobId: string; fileKey: string }>> {
	return db
		.delete(candidates)
		.where(inOrgByIds(orgId, ids))
		.returning({ id: candidates.id, jobId: candidates.jobId, fileKey: candidates.fileKey });
}

// The R2 key and name of a CV file, or null when the candidate isn't the company's.
export async function getCvFile(
	db: Db,
	orgId: string,
	jobId: string,
	id: string,
): Promise<{ fileKey: string; fileName: string } | null> {
	const [row] = await db
		.select({ fileKey: candidates.fileKey, fileName: candidates.fileName })
		.from(candidates)
		.where(inJobById(orgId, jobId, id))
		.limit(1);
	return row ?? null;
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
