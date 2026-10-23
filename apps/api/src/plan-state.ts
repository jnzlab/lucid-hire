import { PLANS, type PlanConfig, type PlanKey, isPlanKey } from "@lucid-hire/plans";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { type SubscriptionStatus, organizations } from "./db/schema.ts";

// Where the web app's billing section lives. Every limit error points here.
export const UPGRADE_URL = "/dashboard/settings/billing";

// Statuses that keep the paid plan. `past_due` stays while Polar retries the payment (the settings page warns the
// admin); `incomplete`, `unpaid` and `canceled` never grant it.
export const ACCESS_STATUSES = ["active", "trialing", "past_due"] as const satisfies readonly SubscriptionStatus[];

export type PlanState = {
	plan: string;
	subscriptionStatus: string | null;
	currentPeriodEnd: number | null;
	cancelAtPeriodEnd?: boolean | null;
};

// Polar charges a renewal first and sends its webhook after, so a paid period that just ended keeps its plan this
// much longer. A missed webhook still can't keep a lapsed plan alive past it.
export const RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;

// Whether a stored subscription grants its paid plan right now: a status that gives access, and a paid period that
// hasn't ended. One that renews keeps the renewal grace; one set to cancel ends with its period. effectivePlan,
// effectivePlanSql and the webhooks all use this rule.
export function grantsAccess(state: Omit<PlanState, "plan">, now: number = Date.now()): boolean {
	if (!(ACCESS_STATUSES as readonly string[]).includes(state.subscriptionStatus ?? "")) return false;
	if (state.currentPeriodEnd === null) return false;
	return state.currentPeriodEnd + (state.cancelAtPeriodEnd ? 0 : RENEWAL_GRACE_MS) > now;
}

// THE function that says which plan a company is on right now. The stored `plan` counts only while its subscription
// grants access.
export function effectivePlan(state: PlanState, now: number = Date.now()): PlanKey {
	if (!isPlanKey(state.plan) || state.plan === "free") return "free";
	return grantsAccess(state, now) ? state.plan : "free";
}

export async function getPlanState(db: Db, orgId: string) {
	const [org] = await db
		.select({
			plan: organizations.plan,
			subscriptionStatus: organizations.subscriptionStatus,
			currentPeriodEnd: organizations.currentPeriodEnd,
			cancelAtPeriodEnd: organizations.cancelAtPeriodEnd,
			polarCustomerId: organizations.polarCustomerId,
			polarSubscriptionId: organizations.polarSubscriptionId,
		})
		.from(organizations)
		.where(eq(organizations.id, orgId))
		.limit(1);
	return org ?? null;
}

export async function getEffectivePlan(db: Db, orgId: string, now: number = Date.now()): Promise<PlanConfig> {
	const state = await getPlanState(db, orgId);
	return PLANS[state ? effectivePlan(state, now) : "free"];
}

// Bigger than any real count, standing in for "unlimited" inside SQL comparisons.
const UNLIMITED = 1e15;

// The effective plan of the `organizations` row in scope as a SQL value, the same rule as effectivePlan() above.
export const effectivePlanSql = (now: number) => sql`(CASE
	WHEN ${organizations.subscriptionStatus} IN ('active', 'trialing', 'past_due')
		AND ${organizations.currentPeriodEnd} > (CASE WHEN ${organizations.cancelAtPeriodEnd} THEN ${now} ELSE ${now - RENEWAL_GRACE_MS} END)
	THEN ${organizations.plan} ELSE 'free' END)`;

// One plan setting as a scalar subquery on the company's row, so a guarded UPDATE or upsert can compare with the
// limit in the same statement and needs no read first. A null setting (unlimited) becomes a huge number.
export function limitSql(orgId: string, pick: (plan: PlanConfig) => number | null, now: number = Date.now()) {
	const value = (key: PlanKey) => pick(PLANS[key]) ?? UNLIMITED;
	return sql`(SELECT CASE ${effectivePlanSql(now)}
		WHEN 'max' THEN ${value("max")} WHEN 'pro' THEN ${value("pro")} ELSE ${value("free")} END
		FROM ${organizations} WHERE ${organizations.id} = ${orgId})`;
}
