import type { PlanKey } from "@lucid-hire/plans";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "./api.ts";
import { useSession } from "./session.ts";

// What GET /billing returns (apps/api/src/billing.ts).
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
	isAdmin: boolean;
};

// Where every limit message sends people to upgrade: Settings → Plan & billing.
export const UPGRADE_PATH = "/dashboard/settings/billing";

// How often the settings page asks again while it waits for Polar's webhook to land, and for how long.
export const BILLING_POLL_MS = 2000;
export const BILLING_POLL_LIMIT_MS = 60_000;

export const billingKey = (userId: string | null | undefined) => ["billing", userId] as const;

// Plan, status and usage. Limits come from here everywhere (job form, CV upload), so one cached request serves them all.
export function useBilling({
	pollWhile,
	alwaysFresh = false,
}: { pollWhile?: (billing: Billing | undefined) => boolean; alwaysFresh?: boolean } = {}) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: billingKey(userId),
		queryFn: async ({ signal }) => apiGet<Billing>("/billing", { token: await token(), signal }),
		// The settings page always shows the latest numbers; the prompts elsewhere make do with a recent copy.
		staleTime: alwaysFresh ? 0 : 30_000,
		refetchInterval: pollWhile ? (query) => (pollWhile(query.state.data) ? BILLING_POLL_MS : false) : false,
	});
}

// Opens Polar's hosted checkout (`url`), or changes the plan of a company that already pays (`changed`).
export function useCheckout() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (plan: "pro" | "max") =>
			apiPost<{ url?: string; changed?: boolean; plan?: PlanKey }>("/billing/checkout", { plan }, { token: await token() }),
		onSuccess: (result) => {
			if (result.changed) void queryClient.invalidateQueries({ queryKey: billingKey(userId) });
		},
	});
}

export function usePortal() {
	const { token } = useSession();
	return useMutation({
		mutationFn: async () => apiPost<{ url: string }>("/billing/portal", undefined, { token: await token() }),
	});
}
