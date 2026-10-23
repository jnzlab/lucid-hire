import { type PaidPlanKey, isPaidPlanKey } from "@lucid-hire/plans";

// The plan a visitor picked on the pricing section, kept through sign-up and onboarding (which may reload the page,
// for example after Google sign-in). Session storage can throw or be empty (private windows), so every use is guarded.
const KEY = "lucidhire:picked-plan";

export function rememberPickedPlan(plan: PaidPlanKey) {
	try {
		sessionStorage.setItem(KEY, plan);
	} catch {
		// Without storage the visitor just doesn't get the highlight.
	}
}

// Reads the picked plan and keeps it, for showing it before onboarding uses it.
export function peekPickedPlan(): PaidPlanKey | undefined {
	try {
		const plan = sessionStorage.getItem(KEY);
		return isPaidPlanKey(plan) ? plan : undefined;
	} catch {
		return undefined;
	}
}

// Reads the picked plan and forgets it, so it is used once.
export function takePickedPlan(): PaidPlanKey | undefined {
	try {
		const plan = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		return isPaidPlanKey(plan) ? plan : undefined;
	} catch {
		return undefined;
	}
}
