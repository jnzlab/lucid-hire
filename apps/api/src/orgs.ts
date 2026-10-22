import { eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { members, organizations, type Role } from "./db/schema.ts";

export type OrgSummary = { id: string; name: string; role: Role };

export const ORG_NAME_MIN = 2;
export const ORG_NAME_MAX = 80;

// Trims the company name and collapses inner whitespace; returns null when it's outside the bounds.
export function normalizeOrgName(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const name = input.trim().replace(/\s+/g, " ");
	return name.length >= ORG_NAME_MIN && name.length <= ORG_NAME_MAX ? name : null;
}

export async function findOrgForUser(db: Db, userId: string): Promise<OrgSummary | null> {
	const [row] = await db
		.select({ id: organizations.id, name: organizations.name, role: members.role })
		.from(members)
		.innerJoin(organizations, eq(organizations.id, members.orgId))
		.where(eq(members.userId, userId))
		.limit(1);
	return row ?? null;
}

// Creates the user's company with them as its admin. Idempotent without a read first: the unique
// index on members.user_id rejects a second company for the same user, the D1 batch (a transaction)
// rolls back its organization row, and the user gets their existing company back. That covers both a
// repeated submit and two racing ones.
export async function createOrgForUser(
	db: Db,
	userId: string,
	name: string,
): Promise<{ org: OrgSummary; created: boolean }> {
	const id = crypto.randomUUID();
	try {
		await db.batch([
			db.insert(organizations).values({ id, name, createdBy: userId }),
			db.insert(members).values({ orgId: id, userId, role: "admin" }),
		]);
		return { org: { id, name, role: "admin" }, created: true };
	} catch (error) {
		const existing = isUniqueViolation(error) ? await findOrgForUser(db, userId) : null;
		if (!existing) throw error;
		return { org: existing, created: false };
	}
}

function isUniqueViolation(error: unknown): boolean {
	for (let e: unknown = error; e instanceof Error; e = e.cause) {
		if (e.message.includes("UNIQUE constraint failed")) return true;
	}
	return false;
}
