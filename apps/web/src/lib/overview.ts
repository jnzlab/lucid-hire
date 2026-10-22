import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api.ts";
import { useSession } from "./session.ts";

export type FunnelCounts = { received: number; scored: number; shortlisted: number };
export type ActivityType =
	| "job_created"
	| "cvs_uploaded"
	| "cv_scored"
	| "cv_failed"
	| "shortlisted"
	| "rejected"
	| "description_rewritten";
export type ActivityEvent = {
	type: ActivityType;
	at: string;
	jobId: string | null;
	jobTitle: string | null;
	candidateId?: string;
	text: string;
};
export type OverviewKpis = {
	activeRoles: { value: number; change: number };
	cvsScreened: { value: number; thisMonth: number; lastMonth: number };
	avgTimeToShortlist: { hours: number | null; previousHours: number | null };
	topMatch: { score: number; candidateName: string; candidateId: string; jobId: string; jobTitle: string } | null;
};
export type OverviewVelocity = { days: Array<{ date: string; uploaded: number }>; totals: FunnelCounts };
export type OverviewAiMix = { scoring: number; descriptionRewrites: number; interviewQuestions: number };

export const overviewKey = (userId: string | null | undefined, card: string) => ["overview", userId, card] as const;

// Each card on the overview page has its own endpoint and query, so one slow or failing card never holds back the rest.
function useOverviewCard<T>(card: string, path: string) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: overviewKey(userId, card),
		queryFn: async ({ signal }) => apiGet<T>(`/overview/${path}`, { token: await token(), signal }),
		// The numbers move as CVs are read; refetch on return rather than show an old picture.
		staleTime: 15_000,
	});
}

export const useOverviewKpis = () => useOverviewCard<OverviewKpis>("kpis", "kpis");
export const useOverviewVelocity = () => useOverviewCard<OverviewVelocity>("velocity", "velocity");
export const useOverviewFunnel = () => useOverviewCard<FunnelCounts>("funnel", "funnel");
export const useOverviewAiMix = () => useOverviewCard<OverviewAiMix>("ai-mix", "ai-mix");
export const useOverviewActivity = () => useOverviewCard<{ events: ActivityEvent[] }>("activity", "activity");
