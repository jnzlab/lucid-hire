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
