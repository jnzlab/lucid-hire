import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { UserDirectory } from "./clerk.ts";
import type { Db } from "./db/client.ts";
import { ROLES, type Role, invites, members, organizations } from "./db/schema.ts";
import { isUniqueViolation } from "./orgs.ts";

export const LAST_ADMIN_MESSAGE = "This is the only admin. Promote someone else before changing this role.";
export const INVITE_DAYS = 7;

export const roleInput = z.object({ role: z.enum(ROLES, { error: "Choose admin or member" }) });

export type TeamMember = {
	userId: string;
	role: Role;
	name: string | null;
	email: string | null;
	imageUrl: string | null;
	joinedAt: Date;
	isYou: boolean;
};

// The company's people, admins first. Roles and join dates are ours; names, emails and pictures come from Clerk in
// one batched call. If Clerk is unreachable the roster still shows, without names.
export async function listTeam(db: Db, env: Env, directory: UserDirectory, orgId: string, viewer: string): Promise<TeamMember[]> {
	const rows = await db
		.select({ userId: members.userId, role: members.role, joinedAt: members.createdAt })
		.from(members)
		.where(eq(members.orgId, orgId))
		.orderBy(asc(members.role), asc(members.createdAt));
	const people = await directory(
		env,
		rows.map((row) => row.userId),
	).catch((error) => {
		console.error("team names not loaded", error);
		return new Map();
	});
	return rows.map((row) => ({
		...row,
		name: people.get(row.userId)?.name ?? null,
		email: people.get(row.userId)?.email ?? null,
		imageUrl: people.get(row.userId)?.imageUrl ?? null,
		isYou: row.userId === viewer,
	}));
}

export type RoleChange = { ok: true; role: Role } | { ok: false; reason: "not_found" | "last_admin" };

// Changes a member's role. Demoting an admin is one guarded UPDATE whose WHERE needs another admin to exist, so two
// admins demoting each other at the same moment can't leave the company without one.
export async function changeRole(db: Db, orgId: string, userId: string, role: Role): Promise<RoleChange> {
	const [target] = await db
		.select({ role: members.role })
		.from(members)
		.where(and(eq(members.orgId, orgId), eq(members.userId, userId)))
		.limit(1);
	if (!target) return { ok: false, reason: "not_found" };
	if (target.role === role) return { ok: true, role };

	const otherAdmin = db
		.select({ one: sql`1` })
		.from(members)
		.where(and(eq(members.orgId, orgId), eq(members.role, "admin"), ne(members.userId, userId)));
	const changed = await db
		.update(members)
		.set({ role })
		.where(
			and(
				eq(members.orgId, orgId),
				eq(members.userId, userId),
				ne(members.role, role),
				role === "member" ? sql`exists ${otherAdmin}` : undefined,
			),
		)
		.returning({ userId: members.userId });
	if (changed.length > 0) return { ok: true, role };

	// Nothing changed: the last admin, or someone else changed this role a moment ago.
	const [now] = await db
		.select({ role: members.role })
		.from(members)
		.where(and(eq(members.orgId, orgId), eq(members.userId, userId)))
		.limit(1);
	if (!now) return { ok: false, reason: "not_found" };
	return now.role === role ? { ok: true, role } : { ok: false, reason: "last_admin" };
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function hashToken(token: string): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createInvite(db: Db, orgId: string, userId: string, now: number = Date.now()) {
	const token = newToken();
	const expiresAt = new Date(now + INVITE_DAYS * 86_400_000);
	await db.insert(invites).values({ tokenHash: await hashToken(token), orgId, createdBy: userId, expiresAt });
	return { token, expiresAt };
}

export type PendingInvite = { id: string; createdAt: Date; expiresAt: Date; createdBy: string };

const pending = (now: number) => and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date(now)));

export function listInvites(db: Db, orgId: string, now: number = Date.now()): Promise<PendingInvite[]> {
	return db
		.select({ id: invites.tokenHash, createdAt: invites.createdAt, expiresAt: invites.expiresAt, createdBy: invites.createdBy })
		.from(invites)
		.where(and(eq(invites.orgId, orgId), pending(now)))
		.orderBy(asc(invites.createdAt));
}

export async function revokeInvite(db: Db, orgId: string, id: string, now: number = Date.now()): Promise<boolean> {
	const revoked = await db
		.update(invites)
		.set({ revokedAt: new Date(now) })
		.where(and(eq(invites.tokenHash, id), eq(invites.orgId, orgId), pending(now)))
		.returning({ id: invites.tokenHash });
	return revoked.length > 0;
}

// The company an invite link leads to, or null when the link is unknown, used, revoked or expired.
export async function findInvite(db: Db, token: string, now: number = Date.now()) {
	const [row] = await db
		.select({ orgId: organizations.id, company: organizations.name })
		.from(invites)
		.innerJoin(organizations, eq(organizations.id, invites.orgId))
		.where(and(eq(invites.tokenHash, await hashToken(token)), pending(now)))
		.limit(1);
	return row ?? null;
}

export type Accepted = { ok: true; org: { id: string; name: string; role: Role } } | { ok: false; reason: "invalid" | "has_company" };

// Joins the user to the invite's company as a member and uses the link up, in one transaction. The insert only
// happens while the link is still pending, so two people racing for one link can't both get in; the unique index on
// members.user_id stops someone who already has a company.
export async function acceptInvite(db: Db, token: string, userId: string, now: number = Date.now()): Promise<Accepted> {
	const tokenHash = await hashToken(token);
	try {
		const [joined] = await db.batch([
			db
				.insert(members)
				.select(
					db
						.select({
							orgId: invites.orgId,
							userId: sql<string>`${userId}`.as("user_id"),
							role: sql<Role>`'member'`.as("role"),
							createdAt: sql<number>`${now}`.as("created_at"),
						})
						.from(invites)
						.where(and(eq(invites.tokenHash, tokenHash), pending(now))),
				)
				.returning({ orgId: members.orgId }),
			db
				.update(invites)
				.set({ acceptedBy: userId, acceptedAt: new Date(now) })
				.where(and(eq(invites.tokenHash, tokenHash), pending(now))),
		]);
		if (joined.length === 0) return { ok: false, reason: "invalid" };
		const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, joined[0].orgId));
		return { ok: true, org: { ...org, role: "member" } };
	} catch (error) {
		if (isUniqueViolation(error)) return { ok: false, reason: "has_company" };
		throw error;
	}
}
