import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.ts";
import { JOB_STATUSES, type JobStatus, jobs } from "./db/schema.ts";

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

export type JobSummary = { id: string; title: string; status: JobStatus; createdAt: Date; updatedAt: Date };
export type Job = JobSummary & { description: string };

const summaryColumns = {
	id: jobs.id,
	title: jobs.title,
	status: jobs.status,
	createdAt: jobs.createdAt,
	updatedAt: jobs.updatedAt,
};
const jobColumns = { ...summaryColumns, description: jobs.description };

// Every query is scoped to the company, so one company can never read or change another's jobs.
const inOrg = (orgId: string, id: string) => and(eq(jobs.id, id), eq(jobs.orgId, orgId));

export function listJobs(db: Db, orgId: string): Promise<JobSummary[]> {
	return db.select(summaryColumns).from(jobs).where(eq(jobs.orgId, orgId)).orderBy(desc(jobs.createdAt));
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
		.values({ id: crypto.randomUUID(), orgId, createdBy: userId, ...input })
		.returning(jobColumns);
	return job;
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

export async function deleteJob(db: Db, orgId: string, id: string): Promise<boolean> {
	const deleted = await db.delete(jobs).where(inOrg(orgId, id)).returning({ id: jobs.id });
	return deleted.length > 0;
}
