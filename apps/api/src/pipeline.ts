import { type SQL, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { candidates } from "./db/schema.ts";

// What the dashboard means by its pipeline words, written once so the jobs list, the overview and the candidates
// page always count alike. "To review": read and scored, and nobody has decided yet. "Reading": queued or being
// scored. Shortlisted, not a fit (`rejected`) and failed go by the decision or the status alone.
export const isToReview = sql`(${candidates.status} = 'scored' and ${candidates.decision} = 'undecided')`;
export const isReading = sql`(${candidates.status} in ('queued', 'scoring'))`;

// Each aggregate is aliased: D1 names unaliased columns by their SQL text, so look-alike ones would collapse into one.
export const countIf = (alias: string, condition: SQL) =>
	sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.as(alias);

// Every job's pipeline counts and latest CV, from one grouped pass over the company's CVs. A job without CVs has no
// row, so callers left-join it and read a missing count as 0.
export function pipelineByJob(db: Db, orgId: string) {
	return db
		.select({
			jobId: candidates.jobId,
			toReview: countIf("p_to_review", isToReview),
			shortlisted: countIf("p_shortlisted", sql`${candidates.decision} = 'shortlisted'`),
			rejected: countIf("p_rejected", sql`${candidates.decision} = 'rejected'`),
			reading: countIf("p_reading", isReading),
			failed: countIf("p_failed", sql`${candidates.status} = 'failed'`),
			scored: countIf("p_scored", sql`${candidates.status} = 'scored'`),
			lastCvAt: sql<number | null>`max(${candidates.createdAt})`.as("p_last_cv_at"),
		})
		.from(candidates)
		.where(eq(candidates.orgId, orgId))
		.groupBy(candidates.jobId)
		.as("pipeline");
}

// A count that SQLite may hand back as null (a job with no pipeline row) or as text.
export const toCount = (value: unknown) => Number(value ?? 0);

// A millisecond timestamp from an aggregate (max, min), as the ISO string Date.toJSON() writes, or null.
export const isoOrNull = (ms: unknown) => (ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString());
