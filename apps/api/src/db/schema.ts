import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

export const PLAN_COLUMN_VALUES = ["free", "pro", "max"] as const;

// Polar's subscription statuses. Only some of them give the paid plan (see plan-state.ts).
export const SUBSCRIPTION_STATUSES = [
	"incomplete",
	"incomplete_expired",
	"trialing",
	"active",
	"past_due",
	"canceled",
	"unpaid",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// A recruiter's company. Onboarding creates one; jobs and plan limits hang off it. Our database is the source of
// truth for the plan: the Polar webhook writes the subscription columns, and `subscription_updated_at` (Polar's
// own timestamp for the change) orders events that arrive out of order.
export const organizations = sqliteTable("organizations", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: createdAt(),
	plan: text("plan", { enum: PLAN_COLUMN_VALUES }).notNull().default("free"),
	polarCustomerId: text("polar_customer_id"),
	polarSubscriptionId: text("polar_subscription_id"),
	subscriptionStatus: text("subscription_status", { enum: SUBSCRIPTION_STATUSES }),
	// When the paid period runs out (ms). The paid plan stops counting after it, whatever the status says.
	currentPeriodEnd: integer("current_period_end"),
	cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
	subscriptionUpdatedAt: integer("subscription_updated_at"),
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
		// The public address: `/jobs/<slug>`. Set once when the job is created and never changed by edits, so shared
		// links keep working. Nullable only because SQLite can't add a unique NOT NULL column; the migration
		// backfills old rows and createJob always sets it.
		slug: text("slug"),
		// R2 key of the optional cover image in the CVS bucket, or null.
		coverKey: text("cover_key"),
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
	(t) => [index("jobs_org_created_idx").on(t.orgId, t.createdAt), uniqueIndex("jobs_slug_unique").on(t.slug)],
);

export const CANDIDATE_STATUSES = ["queued", "scoring", "scored", "failed"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_SOURCES = ["upload", "apply"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const CANDIDATE_DECISIONS = ["undecided", "shortlisted", "rejected"] as const;
export type Decision = (typeof CANDIDATE_DECISIONS)[number];

// One checked requirement from the job, with the CV quote that shows it was met.
export type Requirement = {
	label: string;
	requirement: string;
	importance: "must" | "nice";
	met: boolean;
	evidence: string;
};

// What the CV itself says about the candidate, read in the same Gemini call as the score. Every field is
// optional: whatever the CV doesn't state is left out, never guessed.
export type CandidateProfile = {
	email?: string;
	phone?: string;
	location?: string;
	links: { label?: string; url: string }[];
	skills: string[];
	experience: { title: string; company?: string; start?: string; end?: string; summary?: string }[];
	education: { qualification: string; institution?: string; year?: string }[];
	certifications: string[];
};

// One uploaded CV for a job. The PDF lives in R2 under `file_key`; a Workflow scores it with Gemini and
// fills in the rest. `runs` counts scoring runs started, which caps manual retries. The recruiters' call on
// the CV is `decision` and `note`; `decided_at` and `decided_by` say who last changed the decision, and when.
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
		// Where the CV came from, and the applicant's email when they applied through the public page. Null (never
		// an empty string) when unknown, so the unique index below only ever compares real addresses.
		source: text("source", { enum: CANDIDATE_SOURCES }).notNull().default("upload"),
		email: text("email"),
		profile: text("profile", { mode: "json" }).$type<CandidateProfile>(),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`)
			.$onUpdate(() => new Date()),
		scoredAt: integer("scored_at", { mode: "timestamp_ms" }),
		// Where this CV stands in the reading queue (ms; earlier goes first): when its run began, minus its plan's
		// head start. Null until a run begins, and for old rows, which then count by `created_at`.
		queuePriorityAt: integer("queue_priority_at", { mode: "timestamp_ms" }),
		decision: text("decision", { enum: CANDIDATE_DECISIONS }).notNull().default("undecided"),
		note: text("note"),
		decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
		decidedBy: text("decided_by"),
	},
	// The ranked list is "this job's candidates by score"; the org index backs company-wide cleanup.
	(t) => [
		index("candidates_job_score_idx").on(t.jobId, t.score),
		index("candidates_org_idx").on(t.orgId),
		// The reading queue counts and orders the few CVs that are queued or scoring.
		index("candidates_status_updated_idx").on(t.status, t.updatedAt),
		// One application per email and job. Stored lower case, so the comparison is case-insensitive.
		uniqueIndex("candidates_job_email_unique")
			.on(t.jobId, t.email)
			.where(sql`${t.email} is not null`),
	],
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

export const USAGE_METRICS = ["jobs_month", "ai_hour"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

// How much of an allowance a company has used in a period: `jobs_month` per UTC month ("2026-10"), `ai_hour` per
// UTC hour ("2026-10-22T14"). One guarded upsert both checks and spends the allowance, so a limit check is never a
// COUNT over rows, and deleting a job doesn't give its slot back.
export const usageCounters = sqliteTable(
	"usage_counters",
	{
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		metric: text("metric", { enum: USAGE_METRICS }).notNull(),
		period: text("period").notNull(),
		count: integer("count").notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.orgId, t.metric, t.period] })],
);

// Polar webhook deliveries already handled, so a repeated delivery is ignored. Written after handling succeeds.
export const webhookEvents = sqliteTable("webhook_events", {
	id: text("id").primaryKey(),
	type: text("type").notNull(),
	receivedAt: integer("received_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`),
});

// A link an admin shares so a teammate can join the company. Only the SHA-256 of the token is stored.
export const invites = sqliteTable(
	"invites",
	{
		tokenHash: text("token_hash").primaryKey(),
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		acceptedBy: text("accepted_by"),
		acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("invites_org_idx").on(t.orgId)],
);
