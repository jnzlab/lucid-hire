import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { CV_SCORE_OPERATION } from "./scoring.ts";
import type { Db } from "./db/client.ts";
import { aiUsage, candidates, jobs } from "./db/schema.ts";

const DAY = 86_400_000;
const FUNNEL_DAYS = 90;
const VELOCITY_DAYS = 10;
const SHORTLIST_DAYS = 30;
const ACTIVITY_LIMIT = 8;
// What the AI output mix counts. Other operations are not shown.
const DESCRIPTION_OPERATION = "job_description_enhance";
const QUESTIONS_OPERATION = "interview_questions";

export type ActivityType =
	| "job_created"
	| "cvs_uploaded"
	| "cv_scored"
	| "cv_failed"
	| "shortlisted"
	| "rejected"
	| "description_rewritten";

export type ActivityEvent = {
	type: ActivityType;
	at: string;
	// A rewrite happens in the job form before the job exists, so it has no job.
	jobId: string | null;
	jobTitle: string | null;
	candidateId?: string;
	text: string;
};

export type FunnelCounts = { received: number; scored: number; shortlisted: number };

export type OverviewKpis = {
	activeRoles: { value: number; change: number };
	cvsScreened: { value: number; thisMonth: number; lastMonth: number };
	// Hours from a CV being uploaded to the recruiter shortlisting it; null when nothing was shortlisted.
	avgTimeToShortlist: { hours: number | null; previousHours: number | null };
	topMatch: { score: number; candidateName: string; candidateId: string; jobId: string; jobTitle: string } | null;
};
export type OverviewVelocity = { days: Array<{ date: string; uploaded: number }>; totals: FunnelCounts };
export type OverviewAiMix = { scoring: number; descriptionRewrites: number; interviewQuestions: number };

const monthStart = (date: Date, offset = 0) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
const dayStart = (ms: number) => ms - (ms % DAY);
const iso = (ms: number) => new Date(ms).toISOString();
const hours = (ms: number | null) => (ms === null ? null : Math.round((ms / 3_600_000) * 10) / 10);
const count = (value: unknown) => Number(value ?? 0);
const candidateLabel = (name: string | null, fileName: string) => name ?? fileName;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The overview page is a handful of cards that load and fail on their own, so each has its own function and
// route, and each reads with one D1 batch. Days and months are UTC. `now` is a parameter so tests can fix the clock.

// Each aggregate is aliased: D1 names unaliased columns by their SQL text, so look-alike ones would collapse into one.
const countIf = (alias: string, condition: ReturnType<typeof sql>) =>
	sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.as(alias);
// `column >= from [and column < before]`, for a timestamp column in ms.
const between = (column: typeof candidates.scoredAt | typeof jobs.createdAt, from: number, before?: number) =>
	before === undefined ? sql`${column} >= ${from}` : sql`${column} >= ${from} and ${column} < ${before}`;
const scored = eq(candidates.status, "scored");

export async function getOverviewKpis(db: Db, orgId: string, now = new Date()): Promise<OverviewKpis> {
	const t = now.getTime();
	const thisMonth = monthStart(now);
	const lastMonth = monthStart(now, -1);
	const shortlistFrom = t - SHORTLIST_DAYS * DAY;
	const shortlistBefore = t - 2 * SHORTLIST_DAYS * DAY;
	const ownCandidates = eq(candidates.orgId, orgId);
	const ownJobs = eq(jobs.orgId, orgId);

	const [[js], [cs], top] = await db.batch([
		db
			.select({
				active: countIf("active", sql`${jobs.status} = 'open'`),
				openThisMonth: countIf("openThisMonth", sql`${jobs.status} = 'open' and ${between(jobs.createdAt, thisMonth)}`),
				openLastMonth: countIf(
					"openLastMonth",
					sql`${jobs.status} = 'open' and ${between(jobs.createdAt, lastMonth, thisMonth)}`,
				),
			})
			.from(jobs)
			.where(ownJobs),
		db
			.select({
				scoredAll: countIf("scoredAll", sql`${candidates.status} = 'scored'`),
				scoredThisMonth: countIf("scoredThisMonth", sql`${candidates.status} = 'scored' and ${between(candidates.scoredAt, thisMonth)}`),
				scoredLastMonth: countIf(
					"scoredLastMonth",
					sql`${candidates.status} = 'scored' and ${between(candidates.scoredAt, lastMonth, thisMonth)}`,
				),
				waitNow: sql<number | null>`avg(case when ${candidates.decision} = 'shortlisted' and ${candidates.decidedAt} >= ${shortlistFrom} then ${candidates.decidedAt} - ${candidates.createdAt} end)`.as("waitNow"),
				waitBefore: sql<number | null>`avg(case when ${candidates.decision} = 'shortlisted' and ${candidates.decidedAt} >= ${shortlistBefore} and ${candidates.decidedAt} < ${shortlistFrom} then ${candidates.decidedAt} - ${candidates.createdAt} end)`.as("waitBefore"),
			})
			.from(candidates)
			.where(ownCandidates),
		db
			.select({
				score: candidates.score,
				id: candidates.id,
				name: candidates.name,
				fileName: candidates.fileName,
				jobId: candidates.jobId,
				jobTitle: jobs.title,
			})
			.from(candidates)
			.innerJoin(jobs, eq(jobs.id, candidates.jobId))
			.where(and(ownCandidates, scored, isNotNull(candidates.score)))
			.orderBy(desc(candidates.score), desc(candidates.scoredAt))
			.limit(1),
	]);

	const [best] = top;
	return {
		activeRoles: { value: count(js.active), change: count(js.openThisMonth) - count(js.openLastMonth) },
		cvsScreened: {
			value: count(cs.scoredAll),
			thisMonth: count(cs.scoredThisMonth),
			lastMonth: count(cs.scoredLastMonth),
		},
		avgTimeToShortlist: {
			hours: hours(cs.waitNow === null ? null : Number(cs.waitNow)),
			previousHours: hours(cs.waitBefore === null ? null : Number(cs.waitBefore)),
		},
		topMatch: best
			? {
					score: best.score!,
					candidateName: candidateLabel(best.name, best.fileName),
					candidateId: best.id,
					jobId: best.jobId,
					jobTitle: best.jobTitle,
				}
			: null,
	};
}

// Received, scored and shortlisted over the last 90 days.
const funnelQuery = (db: Db, orgId: string, now: Date) => {
	const since90 = now.getTime() - FUNNEL_DAYS * DAY;
	return db
		.select({
			received: countIf("received", sql`${candidates.createdAt} >= ${since90}`),
			scored90: countIf("scored90", sql`${candidates.status} = 'scored' and ${candidates.createdAt} >= ${since90}`),
			shortlisted90: countIf("shortlisted90", sql`${candidates.decision} = 'shortlisted' and ${candidates.createdAt} >= ${since90}`),
		})
		.from(candidates)
		.where(eq(candidates.orgId, orgId));
};
const funnelCounts = ([row]: Array<{ received: unknown; scored90: unknown; shortlisted90: unknown }>): FunnelCounts => ({
	received: count(row.received),
	scored: count(row.scored90),
	shortlisted: count(row.shortlisted90),
});

export async function getOverviewFunnel(db: Db, orgId: string, now = new Date()): Promise<FunnelCounts> {
	return funnelCounts(await funnelQuery(db, orgId, now));
}

// Uploads per day for the last 10 days, zero-filled, with the 90-day totals that sit under the chart.
export async function getOverviewVelocity(db: Db, orgId: string, now = new Date()): Promise<OverviewVelocity> {
	const velocityFrom = dayStart(now.getTime()) - (VELOCITY_DAYS - 1) * DAY;
	const day = sql<string>`strftime('%Y-%m-%d', ${candidates.createdAt} / 1000, 'unixepoch')`;
	const [perDay, funnel] = await db.batch([
		db
			.select({ date: day, uploaded: sql<number>`count(*)` })
			.from(candidates)
			.where(and(eq(candidates.orgId, orgId), gte(candidates.createdAt, new Date(velocityFrom))))
			.groupBy(day),
		funnelQuery(db, orgId, now),
	]);

	const uploaded = new Map(perDay.map((row) => [row.date, count(row.uploaded)]));
	const days = Array.from({ length: VELOCITY_DAYS }, (_, i) => {
		const date = new Date(velocityFrom + i * DAY).toISOString().slice(0, 10);
		return { date, uploaded: uploaded.get(date) ?? 0 };
	});
	return { days, totals: funnelCounts(funnel) };
}

export async function getOverviewAiMix(db: Db, orgId: string, now = new Date()): Promise<OverviewAiMix> {
	const mixCount = (alias: string, operation: string) => countIf(alias, sql`${aiUsage.operation} = ${operation}`);
	const [mx] = await db
		.select({
			scoring: mixCount("scoring", CV_SCORE_OPERATION),
			descriptions: mixCount("descriptions", DESCRIPTION_OPERATION),
			questions: mixCount("questions", QUESTIONS_OPERATION),
		})
		.from(aiUsage)
		.where(and(eq(aiUsage.orgId, orgId), eq(aiUsage.ok, true), gte(aiUsage.createdAt, new Date(now.getTime() - FUNNEL_DAYS * DAY))));
	return { scoring: count(mx.scoring), descriptionRewrites: count(mx.descriptions), interviewQuestions: count(mx.questions) };
}

export async function getOverviewActivity(db: Db, orgId: string): Promise<ActivityEvent[]> {
	const ownCandidates = eq(candidates.orgId, orgId);
	// Newest first, and `limit` keeps each list small enough to merge in JS.
	const jobEvents = db
		.select({ id: jobs.id, title: jobs.title, at: jobs.createdAt })
		.from(jobs)
		.where(eq(jobs.orgId, orgId))
		.orderBy(desc(jobs.createdAt))
		.limit(ACTIVITY_LIMIT);
	const uploadEvents = db
		.select({
			jobId: candidates.jobId,
			title: jobs.title,
			n: sql<number>`count(*)`,
			at: sql<number>`max(${candidates.createdAt})`,
		})
		.from(candidates)
		.innerJoin(jobs, eq(jobs.id, candidates.jobId))
		.where(ownCandidates)
		.groupBy(candidates.jobId, sql`cast(${candidates.createdAt} / 60000 as integer)`)
		.orderBy(sql`max(${candidates.createdAt}) desc`)
		.limit(ACTIVITY_LIMIT);
	const candidateEvents = (at: typeof candidates.scoredAt | typeof candidates.updatedAt | typeof candidates.decidedAt, where: ReturnType<typeof and>) =>
		db
			.select({
				id: candidates.id,
				jobId: candidates.jobId,
				title: jobs.title,
				name: candidates.name,
				fileName: candidates.fileName,
				decision: candidates.decision,
				at,
			})
			.from(candidates)
			.innerJoin(jobs, eq(jobs.id, candidates.jobId))
			.where(where)
			.orderBy(desc(at))
			.limit(ACTIVITY_LIMIT);

	const [newJobs, uploads, scoredEvents, failedEvents, decided, rewrites] = await db.batch([
		jobEvents,
		uploadEvents,
		candidateEvents(candidates.scoredAt, and(ownCandidates, scored, isNotNull(candidates.scoredAt))),
		candidateEvents(candidates.updatedAt, and(ownCandidates, eq(candidates.status, "failed"))),
		candidateEvents(
			candidates.decidedAt,
			and(ownCandidates, ne(candidates.decision, "undecided"), isNotNull(candidates.decidedAt)),
		),
		db
			.select({ at: aiUsage.createdAt })
			.from(aiUsage)
			.where(and(eq(aiUsage.orgId, orgId), eq(aiUsage.ok, true), eq(aiUsage.operation, DESCRIPTION_OPERATION)))
			.orderBy(desc(aiUsage.createdAt))
			.limit(ACTIVITY_LIMIT),
	]);

	const events: ActivityEvent[] = [
		...newJobs.map((row) => ({
			type: "job_created" as const,
			at: iso(+row.at),
			jobId: row.id,
			jobTitle: row.title,
			text: `Job posted: ${row.title}`,
		})),
		...uploads.map((row) => ({
			type: "cvs_uploaded" as const,
			at: iso(+row.at),
			jobId: row.jobId,
			jobTitle: row.title,
			text: `${plural(count(row.n), "CV", "CVs")} uploaded to ${row.title}`,
		})),
		...scoredEvents.map((row) => ({
			type: "cv_scored" as const,
			at: iso(+row.at!),
			jobId: row.jobId,
			jobTitle: row.title,
			candidateId: row.id,
			text: `${candidateLabel(row.name, row.fileName)} was scored for ${row.title}`,
		})),
		...failedEvents.map((row) => ({
			type: "cv_failed" as const,
			at: iso(+row.at!),
			jobId: row.jobId,
			jobTitle: row.title,
			candidateId: row.id,
			text: `${candidateLabel(row.name, row.fileName)} could not be read for ${row.title}`,
		})),
		...decided.map((row) => ({
			type: row.decision === "shortlisted" ? ("shortlisted" as const) : ("rejected" as const),
			at: iso(+row.at!),
			jobId: row.jobId,
			jobTitle: row.title,
			candidateId: row.id,
			text: `${candidateLabel(row.name, row.fileName)} was ${row.decision} for ${row.title}`,
		})),
		...rewrites.map((row) => ({
			type: "description_rewritten" as const,
			at: iso(+row.at),
			jobId: null,
			jobTitle: null,
			text: "A job description was rewritten with AI",
		})),
	];
	events.sort((a, b) => b.at.localeCompare(a.at));
	return events.slice(0, ACTIVITY_LIMIT);
}
