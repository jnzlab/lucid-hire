import { type RubricItem, visibleItems } from "@lucid-hire/scoring";
import { type SQL, and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.ts";
import { JOB_STATUSES, type JobStatus, type RubricStatus, candidates, jobs } from "./db/schema.ts";
import { countIf, isoOrNull, pipelineByJob, toCount } from "./pipeline.ts";
import { limitSql } from "./plan-state.ts";
import { monthPeriod, returnUnit, takeUnit } from "./usage.ts";

export const JOB_TITLE_MIN = 2;
export const JOB_TITLE_MAX = 120;
// The description goes into every scoring prompt, which is billed per token, so it is capped here
// rather than only in the form.
export const JOB_DESCRIPTION_MAX = 20_000;

const TITLE_HINT = `Enter a job title between ${JOB_TITLE_MIN} and ${JOB_TITLE_MAX} characters`;

// Trimmed, with inner whitespace collapsed, like company names.
const title = z
	.string({ error: TITLE_HINT })
	.transform((value) => value.trim().replace(/\s+/g, " "))
	.pipe(z.string().min(JOB_TITLE_MIN, { error: TITLE_HINT }).max(JOB_TITLE_MAX, { error: TITLE_HINT }));

const description = z
	.string({ error: "Describe the role" })
	.trim()
	.min(1, { error: "Describe the role: what they'll do and what they need" })
	.max(JOB_DESCRIPTION_MAX, { error: "Keep the description to 20,000 characters or fewer" });

export const createJobInput = z.object({
	title,
	description,
	// A new job is saved as a draft or opened straight away; it is closed later.
	status: z.enum(["draft", "open"]).default("draft"),
});

export const updateJobInput = z
	.object({ title: title.optional(), description: description.optional(), status: z.enum(JOB_STATUSES).optional() })
	.refine((patch) => Object.values(patch).some((value) => value !== undefined), { error: "Nothing to update" });

export const enhanceInput = z.object({ title: title.optional(), description });

export const JOBS_PAGE_SIZE = 20;
export const JOB_SEARCH_MAX = 100;
// `activity` is the latest CV first, `review` the most CVs waiting for a decision first.
export const JOB_SORTS = ["newest", "oldest", "title", "candidates", "activity", "review"] as const;

// A search box's text from the query string: trimmed, inner whitespace collapsed, blank meaning no search.
export const searchText = z
	.string()
	.transform((value) => value.trim().replace(/\s+/g, " "))
	.pipe(z.string().max(JOB_SEARCH_MAX, { error: `Search for ${JOB_SEARCH_MAX} characters or fewer` }))
	.default("");

export const pageNumber = z.coerce
	.number({ error: "Page must be a number" })
	.int({ error: "Page must be a whole number" })
	.min(1, { error: "Page starts at 1" })
	.default(1);

// The jobs list's filters, from the query string.
export const listJobsQuery = z.object({
	q: searchText,
	status: z.enum(["all", ...JOB_STATUSES]).default("all"),
	sort: z.enum(JOB_SORTS).default("newest"),
	page: pageNumber,
});
export type ListJobsQuery = z.output<typeof listJobsQuery>;

export type JobSummary = {
	id: string;
	// The public address is `/jobs/<slug>`.
	slug: string;
	title: string;
	status: JobStatus;
	cvCount: number;
	hasCover: boolean;
	createdAt: Date;
	updatedAt: Date;
};
export type Job = JobSummary & {
	description: string;
	// The requirements every CV of the job is checked against, removed ones included (with `removed: true`). Null
	// until the first draft lands.
	rubric: RubricItem[] | null;
	rubricStatus: RubricStatus;
};
// What the list adds: the job's pipeline (counted as in pipeline.ts), its best scored CV and when its latest CV came in.
export type JobListItem = JobSummary & {
	scoredCount: number;
	toReviewCount: number;
	shortlistedCount: number;
	rejectedCount: number;
	readingCount: number;
	failedCount: number;
	// The best scored CV by the job's ranking, and its score.
	topScore: number | null;
	topCandidate: { id: string; name: string | null } | null;
	// When the latest CV was uploaded (ISO), or null for a job without CVs.
	lastCvAt: string | null;
};
// How many of the company's jobs match the search, by status, whatever the status filter.
export type JobCounts = { all: number; open: number; draft: number; closed: number };

const summaryColumns = {
	id: jobs.id,
	// Never null: createJob sets it and the migration backfilled the old rows.
	slug: sql<string>`${jobs.slug}`,
	title: jobs.title,
	status: jobs.status,
	cvCount: jobs.cvCount,
	hasCover: sql<boolean>`${jobs.coverKey} is not null`.mapWith(Boolean),
	createdAt: jobs.createdAt,
	updatedAt: jobs.updatedAt,
};
export const jobColumns = {
	...summaryColumns,
	description: jobs.description,
	rubric: jobs.rubric,
	rubricStatus: jobs.rubricStatus,
};

const SLUG_BASE_MAX = 60;
const SLUG_SUFFIX_LENGTH = 8;
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// A title as lower-case ASCII words joined by hyphens, at most 60 characters and cut at a hyphen. A title with no
// letters or digits at all (legacy bug: it crashed on long titles, and had no fallback) becomes "job".
export function slugify(title: string): string {
	const words = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!words) return "job";
	if (words.length <= SLUG_BASE_MAX) return words;
	const cut = words.slice(0, SLUG_BASE_MAX + 1);
	const at = cut.lastIndexOf("-");
	return (at > 0 ? cut.slice(0, at) : cut.slice(0, SLUG_BASE_MAX)).replace(/-+$/, "");
}

// The slug a new job gets: its title, then 8 random characters so two jobs with one title never collide.
export function newSlug(title: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(SLUG_SUFFIX_LENGTH));
	const suffix = Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
	return `${slugify(title)}-${suffix}`;
}

// Every query is scoped to the company, so one company can never read or change another's jobs.
export const inOrg = (orgId: string, id: string) => and(eq(jobs.id, id), eq(jobs.orgId, orgId));

// `like` patterns for "contains" and "starts with", with the user's own % and _ taken literally.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
export const containing = (text: string) => `%${escapeLike(text)}%`;
export const startingWith = (text: string) => `${escapeLike(text)}%`;

// The job's best scored CV by THE ranking (candidates.ts rankOrder), as JSON, from a subquery per row of the page. The
// (job_id, score) index serves it, so a page of 20 jobs costs 20 index lookups, not a scan.
const topCandidateJson = sql<string | null>`(select json_object('id', t.id, 'name', t.name, 'score', t.score)
	from ${candidates} t where t.job_id = ${jobs.id} and t.status = 'scored' and t.score is not null
	order by t.score desc, t.scored_at, t.created_at, t.id limit 1)`;

// One page of the company's jobs, filtered and sorted, with the total that match and the per-status counts for the
// search. The pipeline counts come from one grouped subquery rather than a query per job. SQLite's `like` ignores case
// for plain letters.
export async function listJobs(
	db: Db,
	orgId: string,
	{ q, status, sort, page }: ListJobsQuery,
): Promise<{ jobs: JobListItem[]; total: number; counts: JobCounts }> {
	const search = q ? containing(q) : null;
	const searched = and(
		eq(jobs.orgId, orgId),
		search
			? sql`(${jobs.title} like ${search} escape '\\' or ${jobs.description} like ${search} escape '\\')`
			: undefined,
	);
	const filter = and(searched, status === "all" ? undefined : eq(jobs.status, status));
	const pipeline = pipelineByJob(db, orgId);
	const toReview = sql<number>`coalesce(${pipeline.toReview}, 0)`;
	// The id breaks ties, so a page never repeats or skips a job.
	const order = {
		newest: [desc(jobs.createdAt), desc(jobs.id)],
		oldest: [asc(jobs.createdAt), asc(jobs.id)],
		title: [sql`${jobs.title} collate nocase asc`, desc(jobs.createdAt), desc(jobs.id)],
		candidates: [desc(jobs.cvCount), desc(jobs.createdAt), desc(jobs.id)],
		activity: [sql`${pipeline.lastCvAt} desc nulls last`, desc(jobs.createdAt), desc(jobs.id)],
		review: [desc(toReview), desc(jobs.createdAt), desc(jobs.id)],
	}[sort];

	const [rows, [counted]] = await db.batch([
		db
			.select({
				...summaryColumns,
				scoredCount: sql<number>`coalesce(${pipeline.scored}, 0)`.as("scored_count"),
				toReviewCount: toReview.as("to_review_count"),
				shortlistedCount: sql<number>`coalesce(${pipeline.shortlisted}, 0)`.as("shortlisted_count"),
				rejectedCount: sql<number>`coalesce(${pipeline.rejected}, 0)`.as("rejected_count"),
				readingCount: sql<number>`coalesce(${pipeline.reading}, 0)`.as("reading_count"),
				failedCount: sql<number>`coalesce(${pipeline.failed}, 0)`.as("failed_count"),
				lastCvAt: sql<number | null>`${pipeline.lastCvAt}`.as("last_cv_at"),
				top: topCandidateJson.as("top_candidate"),
			})
			.from(jobs)
			.leftJoin(pipeline, eq(pipeline.jobId, jobs.id))
			.where(filter)
			.orderBy(...order)
			.limit(JOBS_PAGE_SIZE)
			.offset((page - 1) * JOBS_PAGE_SIZE),
		db
			.select({
				all: sql<number>`count(*)`.as("c_all"),
				open: countIf("c_open", sql`${jobs.status} = 'open'`),
				draft: countIf("c_draft", sql`${jobs.status} = 'draft'`),
				closed: countIf("c_closed", sql`${jobs.status} = 'closed'`),
			})
			.from(jobs)
			.where(searched),
	]);
	const counts: JobCounts = {
		all: toCount(counted.all),
		open: toCount(counted.open),
		draft: toCount(counted.draft),
		closed: toCount(counted.closed),
	};
	return {
		jobs: rows.map(({ top, lastCvAt, ...row }) => {
			const best = top ? (JSON.parse(top) as { id: string; name: string | null; score: number }) : null;
			return {
				...row,
				scoredCount: toCount(row.scoredCount),
				toReviewCount: toCount(row.toReviewCount),
				shortlistedCount: toCount(row.shortlistedCount),
				rejectedCount: toCount(row.rejectedCount),
				readingCount: toCount(row.readingCount),
				failedCount: toCount(row.failedCount),
				topScore: best?.score ?? null,
				topCandidate: best && { id: best.id, name: best.name },
				lastCvAt: isoOrNull(lastCvAt),
			};
		}),
		total: status === "all" ? counts.all : counts[status],
		counts,
	};
}

export async function getJob(db: Db, orgId: string, id: string): Promise<Job | null> {
	const [job] = await db.select(jobColumns).from(jobs).where(inOrg(orgId, id)).limit(1);
	return job ?? null;
}

// A job that opens gets its requirements drafted. These are the statuses that still need a draft.
export const NEEDS_DRAFT: RubricStatus[] = ["none", "failed"];

// A job claimed for a draft, and the version of its list the draft's Workflow is named after.
export type ClaimedDraft = { job: Job; version: number };

const claimedColumns = { ...jobColumns, version: jobs.rubricVersion };
const toClaimed = ({ version, ...job }: Job & { version: number }): ClaimedDraft => ({ job, version });

// Claims the job's next draft in ONE guarded UPDATE, so two triggers racing each other start one draft: the status
// moves to drafting and the version on. Null when no job matches `where` with a status in `from`. `updated_at` is left
// alone: a draft isn't a recruiter's edit.
const claimDraftQuery = (db: Db, where: SQL | undefined, from: RubricStatus[]) =>
	db
		.update(jobs)
		.set({ rubricStatus: "drafting", rubricVersion: sql`${jobs.rubricVersion} + 1`, updatedAt: sql`${jobs.updatedAt}` })
		.where(and(where, inArray(jobs.rubricStatus, from)))
		.returning(claimedColumns);

export async function claimDraft(db: Db, where: SQL | undefined, from: RubricStatus[]): Promise<ClaimedDraft | null> {
	const [claimed] = await claimDraftQuery(db, where, from);
	return claimed ? toClaimed(claimed) : null;
}

// What a new job may start with: a copy brings its source's requirements.
type NewJob = z.output<typeof createJobInput> & { rubric?: RubricItem[] | null };

// A job created open is created drafting (version 1), so the caller only has to start the Workflow.
export async function createJob(db: Db, orgId: string, userId: string, input: NewJob): Promise<Job | "limit"> {
	const period = monthPeriod();
	// The allowance is spent first, in one guarded statement, so two requests racing each other can't both take the
	// last one. A job is never created without being counted.
	if (!(await takeUnit(db, orgId, "jobs_month", period, limitSql(orgId, (plan) => plan.jobsPerMonth)))) {
		return "limit";
	}
	const { rubric, ...fields } = input;
	const rubricState = rubric
		? { rubric, rubricStatus: "ready" as const }
		: input.status === "open"
			? { rubricStatus: "drafting" as const, rubricVersion: 1 }
			: {};
	try {
		const [job] = await db
			.insert(jobs)
			.values({ id: crypto.randomUUID(), orgId, createdBy: userId, slug: newSlug(input.title), ...fields, ...rubricState })
			.returning(jobColumns);
		return job;
	} catch (error) {
		await returnUnit(db, orgId, "jobs_month", period);
		throw error;
	}
}

const COPY_SUFFIX = " (copy)";

// A new draft with the same title, description and requirements, and no candidates. The requirements come over ready,
// without the removed ones, since no CV has evidence for them yet. It goes through `createJob`, so anything that
// limits new jobs applies to a copy too. The title is cut so "(copy)" still fits.
export async function duplicateJob(db: Db, orgId: string, userId: string, id: string): Promise<Job | "limit" | null> {
	const source = await getJob(db, orgId, id);
	if (!source) return null;
	const room = JOB_TITLE_MAX - COPY_SUFFIX.length;
	const base = source.title.length > room ? source.title.slice(0, room).trimEnd() : source.title;
	const rubric = source.rubric ? visibleItems(source.rubric) : [];
	return createJob(db, orgId, userId, {
		title: `${base}${COPY_SUFFIX}`,
		description: source.description,
		status: "draft",
		rubric: rubric.length > 0 ? rubric : null,
	});
}

// Saves the edit. A job that becomes open while it has no requirements (or its last draft failed) is claimed for a
// draft in the same batch, and `draft` comes back for the caller to start the Workflow.
export async function updateJob(
	db: Db,
	orgId: string,
	id: string,
	patch: z.output<typeof updateJobInput>,
): Promise<{ job: Job; draft: ClaimedDraft | null } | null> {
	if (patch.status !== "open") {
		const [job] = await db.update(jobs).set(patch).where(inOrg(orgId, id)).returning(jobColumns);
		return job ? { job, draft: null } : null;
	}
	const [[edited], [claimed]] = await db.batch([
		db.update(jobs).set(patch).where(inOrg(orgId, id)).returning(jobColumns),
		claimDraftQuery(db, and(inOrg(orgId, id), eq(jobs.status, "open")), NEEDS_DRAFT),
	]);
	if (!edited) return null;
	const draft = claimed ? toClaimed(claimed) : null;
	return { job: draft?.job ?? edited, draft };
}

export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export type CoverType = "image/jpeg" | "image/png" | "image/webp";

const startsWith = (bytes: Uint8Array, at: number, signature: number[]) => signature.every((byte, i) => bytes[at + i] === byte);

// The image type the first bytes say it is, or null. The client's Content-Type is never trusted for what gets served.
export function sniffCover(bytes: Uint8Array): CoverType | null {
	if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
	if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
	return null;
}

// One cover per job, so the key is fixed and a new upload replaces the old file.
export const coverKeyFor = (orgId: string, jobId: string) => `covers/${orgId}/${jobId}`;

export async function setJobCover(db: Db, orgId: string, id: string, coverKey: string | null): Promise<Job | null> {
	const [job] = await db.update(jobs).set({ coverKey }).where(inOrg(orgId, id)).returning(jobColumns);
	return job ?? null;
}

export async function deleteJob(db: Db, orgId: string, id: string): Promise<boolean> {
	const deleted = await db.delete(jobs).where(inOrg(orgId, id)).returning({ id: jobs.id });
	return deleted.length > 0;
}
