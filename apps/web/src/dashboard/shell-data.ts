import { useJobs } from "../lib/jobs.ts";
import { useOverviewAttention } from "../lib/overview.ts";

// How often the open jobs ask again while one of them has CVs being read, so the sidebar's live dots and to-review
// counts follow the reading.
export const OPEN_JOBS_POLL_MS = 10_000;

// The open jobs, latest CV activity first, so the sidebar doubles as a work list. The sidebar, the More sheet and the
// palette's "Upload CVs to…" step share this one request.
export function useOpenJobs() {
	return useJobs({ status: "open", sort: "activity" }, { pollMs: OPEN_JOBS_POLL_MS });
}

// CVs waiting for a decision across the company (scored and undecided), for the Candidates badges. The overview page
// reads the same query, so this costs no extra request there; 0 while it loads or fails.
export function useToReviewTotal(): number {
	return useOverviewAttention().data?.totals.toReview ?? 0;
}
