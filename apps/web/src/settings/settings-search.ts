import type { PaidPlanKey } from "@lucid-hire/plans";

// What Plan & billing reads from its address: `checkout=success` is where Polar sends people after paying, `upgrade`
// is the plan they picked on the pricing section before signing up. Anything else is dropped.
export type BillingSearch = { checkout?: "success"; upgrade?: PaidPlanKey };

export function validateBillingSearch(search: Record<string, unknown>): BillingSearch {
	return {
		checkout: search.checkout === "success" ? "success" : undefined,
		upgrade: search.upgrade === "pro" || search.upgrade === "max" ? search.upgrade : undefined,
	};
}

// The settings used to be one page with #plan, #team and #account sections; old links and bookmarks land on the
// sub-page that holds each one now.
export const ANCHOR_PAGES: Record<string, string> = {
	plan: "/dashboard/settings/billing",
	team: "/dashboard/settings/team",
	account: "/dashboard/settings/account",
};
