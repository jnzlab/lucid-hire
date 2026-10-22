import { and, eq, lt, sql, type SQL } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { type UsageMetric, usageCounters } from "./db/schema.ts";
import { UPGRADE_URL, getEffectivePlan, limitSql } from "./plan-state.ts";

// "2026-10": the job allowance resets at the start of each UTC month.
export const monthPeriod = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 7);
// "2026-10-22T14": the AI allowance resets each UTC hour.
export const hourPeriod = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 13);

// Whole seconds until the next UTC hour, for Retry-After.
export function secondsToNextHour(now: number = Date.now()): number {
	const hour = 3_600_000;
	return Math.max(1, Math.ceil((hour - (now % hour)) / 1000));
}

// Spends one unit of an allowance in ONE guarded statement: insert the period's counter at 1, or add 1 only while
// it is below the limit. No row back means the limit is reached. Nothing is ever counted from other tables.
export async function takeUnit(
	db: Db,
	orgId: string,
	metric: UsageMetric,
	period: string,
	limit: SQL,
): Promise<boolean> {
	const rows = await db
		.insert(usageCounters)
		.values({ orgId, metric, period, count: 1 })
		.onConflictDoUpdate({
			target: [usageCounters.orgId, usageCounters.metric, usageCounters.period],
			set: { count: sql`${usageCounters.count} + 1` },
			setWhere: lt(usageCounters.count, limit),
		})
		.returning({ count: usageCounters.count });
	return rows.length > 0;
}

// Gives a unit back when what it paid for never happened. Never throws.
export async function returnUnit(db: Db, orgId: string, metric: UsageMetric, period: string): Promise<void> {
	try {
		await db
			.update(usageCounters)
			.set({ count: sql`max(${usageCounters.count} - 1, 0)` })
			.where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.metric, metric), eq(usageCounters.period, period)));
	} catch (error) {
		console.error("usage unit not returned", error);
	}
}

export async function readUnits(db: Db, orgId: string, metric: UsageMetric, period: string): Promise<number> {
	const [row] = await db
		.select({ count: usageCounters.count })
		.from(usageCounters)
		.where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.metric, metric), eq(usageCounters.period, period)))
		.limit(1);
	return row?.count ?? 0;
}

// Spends one of the company's AI requests for this UTC hour. Null when it may go ahead; otherwise the 429 to send,
// with Retry-After set to the next hour.
export async function takeAiRequest(db: Db, orgId: string, now: number = Date.now()) {
	if (await takeUnit(db, orgId, "ai_hour", hourPeriod(now), limitSql(orgId, (plan) => plan.aiPerHour, now))) return null;
	const plan = await getEffectivePlan(db, orgId, now);
	const wait = secondsToNextHour(now);
	return {
		body: {
			error: {
				code: "plan_limit",
				message: `You've used all ${plan.aiPerHour} AI requests for this hour. They reset at the top of the hour.`,
				upgradeUrl: UPGRADE_URL,
			},
		},
		headers: { "Retry-After": String(wait) },
	};
}
