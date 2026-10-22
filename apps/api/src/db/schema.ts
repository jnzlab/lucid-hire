import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

// A recruiter's company. Onboarding creates one; jobs and plan limits hang off it later.
export const organizations = sqliteTable("organizations", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: createdAt(),
});

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

// Clerk users in an organization. A user belongs to at most one, which the unique index enforces,
// so two onboarding submits racing each other can't create two companies.
export const members = sqliteTable(
	"members",
	{
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull(),
		role: text("role", { enum: ROLES }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.orgId, t.userId] }),
		uniqueIndex("members_user_id_unique").on(t.userId),
	],
);

export const JOB_STATUSES = ["draft", "open", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// A role a company is hiring for. CVs attach to a job and are scored against its description.
export const jobs = sqliteTable(
	"jobs",
	{
		id: text("id").primaryKey(),
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description").notNull(),
		status: text("status", { enum: JOB_STATUSES }).notNull().default("draft"),
		// CVs uploaded so far, including deleted ones: each upload spends a Gemini call, so deleting one
		// doesn't give its slot back. Bumped by a single guarded UPDATE, which is what enforces the limit.
		cvCount: integer("cv_count").notNull().default(0),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`)
			.$onUpdate(() => new Date()),
	},
	// The dashboard list is always "this company's jobs, newest first".
	(t) => [index("jobs_org_created_idx").on(t.orgId, t.createdAt)],
);

export const CANDIDATE_STATUSES = ["queued", "scoring", "scored", "failed"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

// One checked requirement from the job, with the CV quote that shows it was met.
export type Requirement = {
	label: string;
	requirement: string;
	importance: "must" | "nice";
	met: boolean;
	evidence: string;
};

// One uploaded CV for a job. The PDF lives in R2 under `file_key`; a Workflow scores it with Gemini and
// fills in the rest. `runs` counts scoring runs started, which caps manual retries.
export const candidates = sqliteTable(
	"candidates",
	{
		id: text("id").primaryKey(),
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		jobId: text("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		fileKey: text("file_key").notNull(),
		fileName: text("file_name").notNull(),
		fileSize: integer("file_size").notNull(),
		status: text("status", { enum: CANDIDATE_STATUSES }).notNull().default("queued"),
		runs: integer("runs").notNull().default(1),
		// What the recruiter sees when scoring failed.
		error: text("error"),
		name: text("name"),
		headline: text("headline"),
		summary: text("summary"),
		score: integer("score"),
		requirements: text("requirements", { mode: "json" }).$type<Requirement[]>(),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`)
			.$onUpdate(() => new Date()),
		scoredAt: integer("scored_at", { mode: "timestamp_ms" }),
	},
	// The ranked list is "this job's candidates by score"; the org index backs company-wide cleanup.
	(t) => [index("candidates_job_score_idx").on(t.jobId, t.score), index("candidates_org_idx").on(t.orgId)],
);

// One row per Gemini call, failed ones included, so each company's AI spend is visible. Written after
// the response is sent, never in the request's hot path. `job_id` is deliberately not a foreign key:
// usage stays on the books when a job is deleted.
export const aiUsage = sqliteTable(
	"ai_usage",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		orgId: text("org_id").notNull(),
		userId: text("user_id"),
		jobId: text("job_id"),
		operation: text("operation").notNull(),
		model: text("model").notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		ok: integer("ok", { mode: "boolean" }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("ai_usage_org_created_idx").on(t.orgId, t.createdAt)],
);

// One interview question and what it probes: usually the label of a requirement from the scoring.
export type InterviewQuestion = { question: string; focus: string };

// The questions Gemini wrote for a scored candidate. One row per candidate; writing them again replaces the row.
export const interviewQuestions = sqliteTable("interview_questions", {
	candidateId: text("candidate_id")
		.primaryKey()
		.references(() => candidates.id, { onDelete: "cascade" }),
	orgId: text("org_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	jobId: text("job_id")
		.notNull()
		.references(() => jobs.id, { onDelete: "cascade" }),
	questions: text("questions", { mode: "json" }).$type<InterviewQuestion[]>().notNull(),
	// Whoever wrote the current set.
	createdBy: text("created_by").notNull(),
	createdAt: createdAt(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`)
		.$onUpdate(() => new Date()),
});
