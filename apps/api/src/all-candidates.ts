import { type SQL, and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { candidateEmailSql } from "./candidates.ts";
import type { Db } from "./db/client.ts";
import { type CandidateSource, type CandidateStatus, type Decision, candidates, jobs } from "./db/schema.ts";
import { containing, pageNumber, searchText } from "./jobs.ts";
import { countIf, isReading, isToReview, toCount } from "./pipeline.ts";

export const ALL_CANDIDATES_PAGE_SIZE = 50;
export const ALL_CANDIDATES_DECISIONS = ["all", "review", "shortlisted", "rejected", "undecided"] as const;
export const ALL_CANDIDATES_STATUSES = ["any", "scored", "reading", "failed"] as const;
export const ALL_CANDIDATES_SORTS = ["score", "newest", "name", "job"] as const;

// The candidates page's filters, from the query string. A blank search or job means none.
export const allCandidatesQuery = z.object({
	q: searchText,
	jobId: z
		.string()
		.trim()
		.max(100, { error: "That isn't a job" })
		.transform((value) => value || undefined)
		.optional(),
	decision: z.enum(ALL_CANDIDATES_DECISIONS, { error: "Choose all, review, shortlisted, rejected or undecided" }).default("all"),
	status: z.enum(ALL_CANDIDATES_STATUSES, { error: "Choose any, scored, reading or failed" }).default("any"),
	minScore: z.coerce
		.number({ error: "The minimum score must be a number" })
		.int({ error: "The minimum score must be a whole number" })
		.min(0, { error: "The minimum score is between 0 and 100" })
		.max(100, { error: "The minimum score is between 0 and 100" })
		.default(0),
	sort: z.enum(ALL_CANDIDATES_SORTS, { error: "Sort by score, newest, name or job" }).default("score"),
	page: pageNumber,
});
export type AllCandidatesQuery = z.output<typeof allCandidatesQuery>;

export type AllCandidatesRow = {
	id: string;
	jobId: string;
	jobTitle: string;
	name: string | null;
	fileName: string;
	headline: string | null;
	email: string | null;
	score: number | null;
	status: CandidateStatus;
	decision: Decision;
	source: CandidateSource;
	hasNote: boolean;
	createdAt: Date;
	scoredAt: Date | null;
};
// How many candidates each decision filter would list, for the same search and other filters. `all` and `undecided`
// are there too, so the total of any filter is one of these.
export type AllCandidatesCounts = { all: number; review: number; shortlisted: number; rejected: number; undecided: number };

// A candidate search: the name, the email, the headline or the file name contains the text. SQLite's `like` ignores
// case for plain letters.
export const candidateMatches = (search: string) => sql`(${candidates.name} like ${search} escape '\\'
	or ${candidateEmailSql} like ${search} escape '\\'
	or ${candidates.headline} like ${search} escape '\\'
	or ${candidates.fileName} like ${search} escape '\\')`;

const DECISION_FILTER: Record<(typeof ALL_CANDIDATES_DECISIONS)[number], SQL | undefined> = {
	all: undefined,
	review: isToReview,
	shortlisted: sql`${candidates.decision} = 'shortlisted'`,
	rejected: sql`${candidates.decision} = 'rejected'`,
	undecided: sql`${candidates.decision} = 'undecided'`,
};
const STATUS_FILTER: Record<(typeof ALL_CANDIDATES_STATUSES)[number], SQL | undefined> = {
	any: undefined,
	scored: sql`${candidates.status} = 'scored'`,
	reading: isReading,
	failed: sql`${candidates.status} = 'failed'`,
};
// What a name sort compares: the name, or the file name for a CV that hasn't been read.
const displayName = sql`coalesce(nullif(trim(${candidates.name}), ''), ${candidates.fileName}) collate nocase`;

// One page of the company's candidates across all its jobs, with the counts per decision filter. Two statements in one
// D1 batch; the id breaks every tie, so pages never repeat or skip a row. Ranks are per job, so they aren't here.
export async function listAllCandidates(
	db: Db,
	orgId: string,
	{ q, jobId, decision, status, minScore, sort, page }: AllCandidatesQuery,
): Promise<{ candidates: AllCandidatesRow[]; total: number; counts: AllCandidatesCounts }> {
	// Everything but the decision, which the counts split by.
	const filtered = and(
		eq(candidates.orgId, orgId),
		q ? candidateMatches(containing(q)) : undefined,
		jobId ? eq(candidates.jobId, jobId) : undefined,
		STATUS_FILTER[status],
		minScore > 0 ? sql`${candidates.score} >= ${minScore}` : undefined,
	);
	// Best match is a job's list across jobs: scored CVs by score, ties broken as THE ranking does (candidates.ts
	// rankOrder), then CVs still being read, then failed ones.
	const byScore = [
		sql`case ${candidates.status} when 'scored' then 0 when 'failed' then 2 else 1 end`,
		desc(candidates.score),
		asc(candidates.scoredAt),
		asc(candidates.createdAt),
		asc(candidates.id),
	];
	const order = {
		score: byScore,
		newest: [desc(candidates.createdAt), desc(candidates.id)],
		name: [asc(displayName), asc(candidates.id)],
		job: [sql`${jobs.title} collate nocase asc`, asc(jobs.id), ...byScore],
	}[sort];

	const [rows, [counted]] = await db.batch([
		db
			.select({
				id: candidates.id,
				jobId: candidates.jobId,
				jobTitle: jobs.title,
				name: candidates.name,
				fileName: candidates.fileName,
				headline: candidates.headline,
				email: candidateEmailSql,
				score: candidates.score,
				status: candidates.status,
				decision: candidates.decision,
				source: candidates.source,
				hasNote: sql<boolean>`${candidates.note} is not null`.mapWith(Boolean),
				createdAt: candidates.createdAt,
				scoredAt: candidates.scoredAt,
			})
			.from(candidates)
			.innerJoin(jobs, eq(jobs.id, candidates.jobId))
			.where(and(filtered, DECISION_FILTER[decision]))
			.orderBy(...order)
			.limit(ALL_CANDIDATES_PAGE_SIZE)
			.offset((page - 1) * ALL_CANDIDATES_PAGE_SIZE),
		db
			.select({
				all: sql<number>`count(*)`.as("c_all"),
				review: countIf("c_review", isToReview),
				shortlisted: countIf("c_shortlisted", sql`${candidates.decision} = 'shortlisted'`),
				rejected: countIf("c_rejected", sql`${candidates.decision} = 'rejected'`),
				undecided: countIf("c_undecided", sql`${candidates.decision} = 'undecided'`),
			})
			.from(candidates)
			.where(filtered),
	]);
	const counts: AllCandidatesCounts = {
		all: toCount(counted.all),
		review: toCount(counted.review),
		shortlisted: toCount(counted.shortlisted),
		rejected: toCount(counted.rejected),
		undecided: toCount(counted.undecided),
	};
	return { candidates: rows, total: counts[decision], counts };
}
