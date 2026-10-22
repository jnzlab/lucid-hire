import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
