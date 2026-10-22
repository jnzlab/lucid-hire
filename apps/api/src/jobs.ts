import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.ts";
import { JOB_STATUSES, type JobStatus, candidates, jobs } from "./db/schema.ts";

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
export const JOB_SORTS = ["newest", "oldest", "title", "candidates"] as const;

// The jobs list's filters, from the query string. A blank search means no search.
export const listJobsQuery = z.object({
	q: z
		.string()
		.transform((value) => value.trim().replace(/\s+/g, " "))
		.pipe(z.string().max(JOB_SEARCH_MAX, { error: `Search for ${JOB_SEARCH_MAX} characters or fewer` }))
		.default(""),
	status: z.enum(["all", ...JOB_STATUSES]).default("all"),
	sort: z.enum(JOB_SORTS).default("newest"),
	page: z.coerce.number({ error: "Page must be a number" }).int({ error: "Page must be a whole number" }).min(1, { error: "Page starts at 1" }).default(1),
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
export type Job = JobSummary & { description: string };
// What the list adds: how many of the job's CVs have been read and scored.
export type JobListItem = JobSummary & { scoredCount: number };

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
const jobColumns = { ...summaryColumns, description: jobs.description };

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

// `like` pattern for "contains", with the user's own % and _ taken literally.
const containing = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

// One page of the company's jobs, filtered and sorted, with the total that match. The scored count comes from a
// single grouped subquery rather than a query per job. SQLite's `like` ignores case for plain letters.
export async function listJobs(
	db: Db,
	orgId: string,
	{ q, status, sort, page }: ListJobsQuery,
): Promise<{ jobs: JobListItem[]; total: number }> {
	const search = q ? containing(q) : null;
	const filter = and(
		eq(jobs.orgId, orgId),
		status === "all" ? undefined : eq(jobs.status, status),
		search
			? sql`(${jobs.title} like ${search} escape '\\' or ${jobs.description} like ${search} escape '\\')`
			: undefined,
	);
	const scored = db
		.select({ jobId: candidates.jobId, n: count().as("scored_n") })
		.from(candidates)
		.where(and(eq(candidates.orgId, orgId), eq(candidates.status, "scored")))
		.groupBy(candidates.jobId)
		.as("scored");
	// The id breaks ties, so a page never repeats or skips a job.
	const order = {
		newest: [desc(jobs.createdAt), desc(jobs.id)],
		oldest: [asc(jobs.createdAt), asc(jobs.id)],
		title: [sql`${jobs.title} collate nocase asc`, desc(jobs.createdAt), desc(jobs.id)],
		candidates: [desc(jobs.cvCount), desc(jobs.createdAt), desc(jobs.id)],
	}[sort];

	const [rows, [totals]] = await db.batch([
		db
			.select({ ...summaryColumns, scoredCount: sql<number>`coalesce(${scored.n}, 0)`.as("scored_count") })
			.from(jobs)
			.leftJoin(scored, eq(scored.jobId, jobs.id))
			.where(filter)
			.orderBy(...order)
			.limit(JOBS_PAGE_SIZE)
			.offset((page - 1) * JOBS_PAGE_SIZE),
		db.select({ total: count() }).from(jobs).where(filter),
	]);
	return { jobs: rows.map((row) => ({ ...row, scoredCount: Number(row.scoredCount) })), total: totals.total };
}

export async function getJob(db: Db, orgId: string, id: string): Promise<Job | null> {
	const [job] = await db.select(jobColumns).from(jobs).where(inOrg(orgId, id)).limit(1);
	return job ?? null;
}

export async function createJob(
	db: Db,
	orgId: string,
	userId: string,
	input: z.output<typeof createJobInput>,
): Promise<Job> {
	const [job] = await db
		.insert(jobs)
		.values({ id: crypto.randomUUID(), orgId, createdBy: userId, slug: newSlug(input.title), ...input })
		.returning(jobColumns);
	return job;
}

const COPY_SUFFIX = " (copy)";

// A new draft with the same title and description and no candidates. It goes through `createJob`, so
// anything that limits new jobs applies to a copy too. The title is cut so "(copy)" still fits.
export async function duplicateJob(db: Db, orgId: string, userId: string, id: string): Promise<Job | null> {
	const source = await getJob(db, orgId, id);
	if (!source) return null;
	const room = JOB_TITLE_MAX - COPY_SUFFIX.length;
	const base = source.title.length > room ? source.title.slice(0, room).trimEnd() : source.title;
	return createJob(db, orgId, userId, {
		title: `${base}${COPY_SUFFIX}`,
		description: source.description,
		status: "draft",
	});
}

export async function updateJob(
	db: Db,
	orgId: string,
	id: string,
	patch: z.output<typeof updateJobInput>,
): Promise<Job | null> {
	const [job] = await db.update(jobs).set(patch).where(inOrg(orgId, id)).returning(jobColumns);
	return job ?? null;
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
