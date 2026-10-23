import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { candidateMatches } from "./all-candidates.ts";
import type { Db } from "./db/client.ts";
import { type Decision, type JobStatus, candidates, jobs } from "./db/schema.ts";
import { JOB_SEARCH_MAX, containing, startingWith } from "./jobs.ts";

export const SEARCH_LIMIT = 6;
const SEARCH_HINT = `Search for 1 to ${JOB_SEARCH_MAX} characters`;

// The command palette's text: trimmed, inner whitespace collapsed, and never blank.
export const searchInput = z.object({
	q: z
		.string({ error: SEARCH_HINT })
		.transform((value) => value.trim().replace(/\s+/g, " "))
		.pipe(z.string().min(1, { error: SEARCH_HINT }).max(JOB_SEARCH_MAX, { error: SEARCH_HINT })),
});

export type SearchResults = {
	jobs: Array<{ id: string; title: string; status: JobStatus; cvCount: number }>;
	candidates: Array<{
		id: string;
		jobId: string;
		jobTitle: string;
		name: string | null;
		fileName: string;
		headline: string | null;
		score: number | null;
		decision: Decision;
	}>;
};

// Jobs by title and candidates by name, email, headline or file name, six of each, for the command palette. A title
// or name that starts with the text comes first; then open jobs before drafts and closed ones, and better scores
// before worse. One D1 batch.
export async function searchOrg(db: Db, orgId: string, q: string): Promise<SearchResults> {
	const search = containing(q);
	const prefix = startingWith(q);
	const [jobRows, candidateRows] = await db.batch([
		db
			.select({ id: jobs.id, title: jobs.title, status: jobs.status, cvCount: jobs.cvCount })
			.from(jobs)
			.where(and(eq(jobs.orgId, orgId), sql`${jobs.title} like ${search} escape '\\'`))
			.orderBy(
				sql`(${jobs.title} like ${prefix} escape '\\') desc`,
				sql`case ${jobs.status} when 'open' then 0 when 'draft' then 1 else 2 end`,
				desc(jobs.createdAt),
				desc(jobs.id),
			)
			.limit(SEARCH_LIMIT),
		db
			.select({
				id: candidates.id,
				jobId: candidates.jobId,
				jobTitle: jobs.title,
				name: candidates.name,
				fileName: candidates.fileName,
				headline: candidates.headline,
				score: candidates.score,
				decision: candidates.decision,
			})
			.from(candidates)
			.innerJoin(jobs, eq(jobs.id, candidates.jobId))
			.where(and(eq(candidates.orgId, orgId), candidateMatches(search)))
			.orderBy(
				sql`(coalesce(${candidates.name}, '') like ${prefix} escape '\\') desc`,
				desc(candidates.score),
				desc(candidates.createdAt),
				asc(candidates.id),
			)
			.limit(SEARCH_LIMIT),
	]);
	return { jobs: jobRows, candidates: candidateRows };
}
