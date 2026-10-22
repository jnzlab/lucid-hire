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
export type Overview = {
	kpis: {
		activeRoles: { value: number; change: number };
		cvsScreened: { value: number; thisMonth: number; lastMonth: number };
		avgTimeToShortlist: { hours: number | null; previousHours: number | null };
		topMatch: { score: number; candidateName: string; candidateId: string; jobId: string; jobTitle: string } | null;
	};
	velocity: { days: Array<{ date: string; uploaded: number }>; totals: FunnelCounts };
	funnel: FunnelCounts;
	aiMix: { scoring: number; descriptionRewrites: number; interviewQuestions: number };
	activity: ActivityEvent[];
};

export const overviewKey = (userId: string | null | undefined) => ["overview", userId] as const;

export function useOverview() {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: overviewKey(userId),
		queryFn: async ({ signal }) => apiGet<Overview>("/overview", { token: await token(), signal }),
		// The numbers move as CVs are read; refetch on return rather than show an old picture.
		staleTime: 15_000,
	});
}
