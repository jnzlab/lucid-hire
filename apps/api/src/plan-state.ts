import { PLANS, type PlanConfig, type PlanKey, isPlanKey } from "@lucid-hire/plans";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { type SubscriptionStatus, organizations } from "./db/schema.ts";

// Where the web app's billing section lives. Every limit error points here.
export const UPGRADE_URL = "/dashboard/settings#plan";

// Statuses that keep the paid plan. `past_due` stays while Polar retries the payment (the settings page warns the
// admin); `incomplete`, `unpaid` and `canceled` never grant it.
export const ACCESS_STATUSES = ["active", "trialing", "past_due"] as const satisfies readonly SubscriptionStatus[];

export type PlanState = {
	plan: string;
	subscriptionStatus: string | null;
	currentPeriodEnd: number | null;
};

// THE function that says which plan a company is on right now. The stored `plan` counts only while the
// subscription grants access and its paid period hasn't ended, so a missed webhook can't keep a lapsed plan alive.
export function effectivePlan(state: PlanState, now: number = Date.now()): PlanKey {
	if (!isPlanKey(state.plan) || state.plan === "free") return "free";
	const grants = (ACCESS_STATUSES as readonly string[]).includes(state.subscriptionStatus ?? "");
	return grants && state.currentPeriodEnd !== null && state.currentPeriodEnd > now ? state.plan : "free";
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

// The company's effective plan as a SQL value, the same rule as effectivePlan() above.
const effectivePlanSql = (now: number) => sql`(CASE
	WHEN ${organizations.subscriptionStatus} IN ('active', 'trialing', 'past_due')
		AND ${organizations.currentPeriodEnd} > ${now}
	THEN ${organizations.plan} ELSE 'free' END)`;

// One plan setting as a scalar subquery on the company's row, so a guarded UPDATE or upsert can compare with the
// limit in the same statement and needs no read first. A null setting (unlimited) becomes a huge number.
export function limitSql(orgId: string, pick: (plan: PlanConfig) => number | null, now: number = Date.now()) {
	const value = (key: PlanKey) => pick(PLANS[key]) ?? UNLIMITED;
	return sql`(SELECT CASE ${effectivePlanSql(now)}
		WHEN 'max' THEN ${value("max")} WHEN 'pro' THEN ${value("pro")} ELSE ${value("free")} END
		FROM ${organizations} WHERE ${organizations.id} = ${orgId})`;
}
