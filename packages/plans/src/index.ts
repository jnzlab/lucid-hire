// The one definition of the plans. The API enforces these numbers, the landing page and the settings page show
// them, so a limit can never read differently on screen than it is enforced.

export const PLAN_KEYS = ["free", "pro", "max"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export type PlanConfig = {
	key: PlanKey;
	name: string;
	// US dollars a month.
	priceUsd: number;
	cvsPerJob: number;
	// New jobs per UTC month; null is unlimited.
	jobsPerMonth: number | null;
	aiPerHour: number;
	queueLabel: string;
};

export const PLANS: Record<PlanKey, PlanConfig> = {
	free: { key: "free", name: "Free", priceUsd: 0, cvsPerJob: 10, jobsPerMonth: 10, aiPerHour: 30, queueLabel: "Standard reading queue" },
	pro: { key: "pro", name: "Pro", priceUsd: 10, cvsPerJob: 100, jobsPerMonth: 20, aiPerHour: 150, queueLabel: "Priority in the reading queue" },
	max: { key: "max", name: "Max", priceUsd: 30, cvsPerJob: 1000, jobsPerMonth: null, aiPerHour: 600, queueLabel: "First in the reading queue" },
};

export const PAID_PLAN_KEYS = ["pro", "max"] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

export function isPlanKey(value: unknown): value is PlanKey {
	return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
	return value === "pro" || value === "max";
}

export function formatCount(n: number): string {
	return n.toLocaleString("en-GB");
}

export function priceLabel(plan: PlanConfig): string {
	return `$${plan.priceUsd}`;
}

// The bullet list shown on a plan card.
export function planFeatures(plan: PlanConfig): string[] {
	return [
		`${formatCount(plan.cvsPerJob)} CVs per job`,
		plan.jobsPerMonth === null ? "Unlimited jobs" : `${formatCount(plan.jobsPerMonth)} jobs a month`,
		`${formatCount(plan.aiPerHour)} AI requests an hour`,
		plan.queueLabel,
	];
}

// Which plan is bigger, for telling an upgrade from a downgrade.
export function planRank(key: PlanKey): number {
	return PLAN_KEYS.indexOf(key);
}

// The cheapest plan that reads this many CVs for one job.
export function planForCvs(cvsPerJob: number): PlanKey {
	return PLAN_KEYS.find((key) => PLANS[key].cvsPerJob >= cvsPerJob) ?? "max";
}
