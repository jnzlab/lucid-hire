import { desc, eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { jobs } from "./db/schema.ts";
import { PLANS, type PlanKey } from "@lucid-hire/plans";
import { effectivePlan, getPlanState } from "./plan-state.ts";
import { hourPeriod, monthPeriod, readUnits } from "./usage.ts";

export type Billing = {
	plan: PlanKey;
	effectivePlan: PlanKey;
	status: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	usage: {
		jobsThisMonth: number;
		// Null on a plan with no limit.
		jobsLimit: number | null;
		busiestJob: { id: string; title: string; cvCount: number } | null;
		cvLimit: number;
		aiThisHour: number;
		aiLimit: number;
	};
};

// Everything the settings page shows about plan and usage: a few primary-key reads, no counting.
export async function getBilling(db: Db, orgId: string, now: number = Date.now()): Promise<Billing> {
	const [state, jobsThisMonth, aiThisHour, [busiest]] = await Promise.all([
		getPlanState(db, orgId),
		readUnits(db, orgId, "jobs_month", monthPeriod(now)),
		readUnits(db, orgId, "ai_hour", hourPeriod(now)),
		db
			.select({ id: jobs.id, title: jobs.title, cvCount: jobs.cvCount })
			.from(jobs)
			.where(eq(jobs.orgId, orgId))
			.orderBy(desc(jobs.cvCount))
			.limit(1),
	]);
	const stored = state ?? { plan: "free", subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
	const effective = effectivePlan(stored, now);
	const limits = PLANS[effective];
	return {
		plan: stored.plan as PlanKey,
		effectivePlan: effective,
		status: stored.subscriptionStatus,
		currentPeriodEnd: stored.currentPeriodEnd === null ? null : new Date(stored.currentPeriodEnd).toISOString(),
		cancelAtPeriodEnd: stored.cancelAtPeriodEnd,
		usage: {
			jobsThisMonth,
			jobsLimit: limits.jobsPerMonth,
			busiestJob: busiest && busiest.cvCount > 0 ? busiest : null,
			cvLimit: limits.cvsPerJob,
			aiThisHour,
			aiLimit: limits.aiPerHour,
		},
	};
}
