import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api.ts";
import type { Decision } from "./candidates.ts";
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

// A to-review CV in the work queue.
export type AttentionCandidate = {
	candidateId: string;
	name: string | null;
	fileName: string;
	headline: string | null;
	score: number;
};
// What GET /overview/attention returns: the work queue. "To review" is scored and undecided, "reading" is queued or
// being scored.
export type OverviewAttention = {
	// Across every job of the company, whatever its status. `jobsToReview` is how many jobs have a CV to review.
	totals: { toReview: number; reading: number; failed: number; openJobs: number; jobsToReview: number };
	// Open jobs with CVs to review or being read, most to review first (at most 6), each with its best three to review.
	waiting: Array<{
		jobId: string;
		jobTitle: string;
		toReview: number;
		shortlisted: number;
		reading: number;
		top: AttentionCandidate[];
	}>;
	// Jobs of any status with CVs that couldn't be read, most first (at most 10).
	failed: Array<{ jobId: string; jobTitle: string; count: number }>;
	// Open jobs without any CVs, newest first (at most 5).
	emptyOpenJobs: Array<{ jobId: string; jobTitle: string; slug: string }>;
	// The latest drafts, last edited first (at most 5).
	drafts: Array<{ jobId: string; jobTitle: string; updatedAt: string }>;
	// The best CVs scored in the last 7 days across jobs, whatever their decision (at most 5).
	bestNew: Array<{
		candidateId: string;
		jobId: string;
		jobTitle: string;
		name: string | null;
		fileName: string;
		headline: string | null;
		score: number;
		decision: Decision;
		scoredAt: string;
	}>;
};

// `overviewKey(userId)` alone is the prefix of every card, for invalidating them all.
export const overviewKey = (userId: string | null | undefined, card?: string) =>
	(card === undefined ? ["overview", userId] : ["overview", userId, card]) as readonly unknown[];

// How often the work queue asks again while CVs are being read, so its counts (and the sidebar badge) catch up.
export const ATTENTION_POLL_MS = 10_000;

// Each card on the overview page has its own endpoint and query, so one slow or failing card never holds back the rest.
function useOverviewCard<T>(card: string, path: string, refetchInterval?: (data: T | undefined) => number | false) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: overviewKey(userId, card),
		queryFn: async ({ signal }) => apiGet<T>(`/overview/${path}`, { token: await token(), signal }),
		// The numbers move as CVs are read; refetch on return rather than show an old picture.
		staleTime: 15_000,
		refetchInterval: refetchInterval ? ({ state }) => refetchInterval(state.data) : false,
	});
}

export const useOverviewKpis = () => useOverviewCard<OverviewKpis>("kpis", "kpis");
export const useOverviewVelocity = () => useOverviewCard<OverviewVelocity>("velocity", "velocity");
export const useOverviewFunnel = () => useOverviewCard<FunnelCounts>("funnel", "funnel");
export const useOverviewAiMix = () => useOverviewCard<OverviewAiMix>("ai-mix", "ai-mix");
export const useOverviewActivity = () => useOverviewCard<{ events: ActivityEvent[] }>("activity", "activity");
// The work queue. Shared by the overview page and the dashboard's to-review badges, so one request serves both.
export const useOverviewAttention = () =>
	useOverviewCard<OverviewAttention>("attention", "attention", (data) =>
		data && data.totals.reading > 0 ? ATTENTION_POLL_MS : false,
	);
