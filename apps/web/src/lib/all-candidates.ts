import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "./api.ts";
import type { CandidateStatus, Decision } from "./candidates.ts";
import { useSession } from "./session.ts";

// What GET /candidates takes and returns (apps/api/src/all-candidates.ts): the company's candidates across every job.
export const ALL_CANDIDATES_PAGE_SIZE = 50;
export const CANDIDATE_SEARCH_MAX = 100;

// "review" is scored and undecided, like "To review" everywhere; the others are the decision itself.
export const DECISION_FILTERS = ["all", "review", "shortlisted", "rejected", "undecided"] as const;
export type DecisionFilter = (typeof DECISION_FILTERS)[number];
export const DECISION_FILTER_LABEL: Record<DecisionFilter, string> = {
	all: "All",
	review: "To review",
	shortlisted: "Shortlisted",
	rejected: "Not a fit",
	undecided: "Undecided",
};

// "reading" is queued or being scored.
export const STATUS_FILTERS = ["any", "scored", "reading", "failed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
	any: "Any status",
	scored: "Scored",
	reading: "Reading",
	failed: "Failed",
};

// The minimum scores on offer. Anything else in a link is dropped, so the menu always shows what is applied.
export const MIN_SCORES = [50, 70, 85] as const;
export type MinScore = (typeof MIN_SCORES)[number];

// `score` is best match (unscored CVs last), `job` is by job title and then best match.
export const ALL_CANDIDATE_SORTS = ["score", "newest", "name", "job"] as const;
export type AllCandidateSort = (typeof ALL_CANDIDATE_SORTS)[number];
export const ALL_CANDIDATE_SORT_LABEL: Record<AllCandidateSort, string> = {
	score: "Best match",
	newest: "Newest",
	name: "Name",
	job: "Job",
};

// What the candidates page is showing. This is the page's URL search too, so a default is simply left out of it.
export type AllCandidatesFilters = {
	q?: string;
	jobId?: string;
	decision?: Exclude<DecisionFilter, "all">;
	status?: Exclude<StatusFilter, "any">;
	minScore?: MinScore;
	sort?: Exclude<AllCandidateSort, "score">;
	page?: number;
};

export type AllCandidate = {
	id: string;
	jobId: string;
	jobTitle: string;
	// Null until the CV is read (show the file name instead, as candidateName() does).
	name: string | null;
	fileName: string;
	headline: string | null;
	// The address the applicant gave when applying, else the one on the CV.
	email: string | null;
	score: number | null;
	status: CandidateStatus;
	decision: Decision;
	source: "upload" | "apply";
	hasNote: boolean;
	createdAt: string;
	scoredAt: string | null;
};
// How many candidates each decision filter would list for the other filters (q, job, status, minimum score).
export type AllCandidatesCounts = { all: number; review: number; shortlisted: number; rejected: number; undecided: number };
export type AllCandidatesList = {
	candidates: AllCandidate[];
	// How many match every filter, the decision included: counts[decision].
	total: number;
	page: number;
	pageSize: number;
	counts: AllCandidatesCounts;
};

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T | undefined => {
	const found = options.find((option) => option === value);
	return found === undefined || found === fallback ? undefined : found;
};

// The router parses a value that looks like JSON ("12345", "true"), so a search or an id can arrive as a number.
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

// The route's validateSearch: what a link to the candidates page asks for, with anything unreadable dropped so a bad
// link shows the plain list. Defaults are left out, like the jobs list.
export function validateAllCandidatesSearch(search: Record<string, unknown>): AllCandidatesFilters {
	const q = text(search.q).trim().slice(0, CANDIDATE_SEARCH_MAX);
	const rawJobId = text(search.jobId);
	const jobId = rawJobId.length <= 100 ? rawJobId.trim() : "";
	const minScore = MIN_SCORES.find((score) => score === Number(search.minScore));
	const page = Number(search.page);
	return {
		q: q || undefined,
		jobId: jobId || undefined,
		decision: pick(DECISION_FILTERS, search.decision, "all") as AllCandidatesFilters["decision"],
		status: pick(STATUS_FILTERS, search.status, "any") as AllCandidatesFilters["status"],
		minScore,
		sort: pick(ALL_CANDIDATE_SORTS, search.sort, "score") as AllCandidatesFilters["sort"],
		page: Number.isInteger(page) && page > 1 ? page : undefined,
	};
}

// Whether anything narrows the list (the sort and the page don't), for "Clear filters" and the "none match" state.
export const isFilteredView = ({ q, jobId, decision, status, minScore }: AllCandidatesFilters) =>
	Boolean(q || jobId || decision || status || minScore);

export function allCandidatesPath({ q, jobId, decision, status, minScore, sort, page }: AllCandidatesFilters) {
	const params = new URLSearchParams();
	if (q) params.set("q", q);
	if (jobId) params.set("jobId", jobId);
	if (decision) params.set("decision", decision);
	if (status) params.set("status", status);
	if (minScore) params.set("minScore", String(minScore));
	if (sort) params.set("sort", sort);
	if (page && page > 1) params.set("page", String(page));
	const query = params.toString();
	return query ? `/candidates?${query}` : "/candidates";
}

const VIEW_KEY = "lh-candidates-view";
const LIST_PATH = "/dashboard/candidates";

// The list's address as the recruiter last left it, for this tab, so a candidate opened from the list links back to
// the same filters and page. Storage can be blocked; the plain list stands in.
export function rememberCandidatesView(filters: AllCandidatesFilters) {
	try {
		sessionStorage.setItem(VIEW_KEY, `/dashboard${allCandidatesPath(filters)}`);
	} catch {
		// Nothing to remember it in.
	}
}

export function candidatesViewHref() {
	try {
		const href = sessionStorage.getItem(VIEW_KEY);
		if (href === LIST_PATH || href?.startsWith(`${LIST_PATH}?`)) return href;
	} catch {
		// Fall through to the plain list.
	}
	return LIST_PATH;
}

// Keyed by user like the jobs; `allCandidatesKey` is the prefix of every cached page and filter.
export const allCandidatesKey = (userId: string | null | undefined) => ["all-candidates", userId] as const;

// How often the page asks again while a CV on it is still being read.
export const ALL_CANDIDATES_POLL_MS = 5000;

// One page of the company's candidates. While the next filter or page loads, the rows on screen stay.
export function useAllCandidates(filters: AllCandidatesFilters = {}, { enabled = true }: { enabled?: boolean } = {}) {
	const { userId, token } = useSession();
	const path = allCandidatesPath(filters);
	return useQuery({
		queryKey: [...allCandidatesKey(userId), path] as const,
		queryFn: async ({ signal }) => apiGet<AllCandidatesList>(path, { token: await token(), signal }),
		enabled,
		placeholderData: keepPreviousData,
		refetchInterval: ({ state }) =>
			state.data?.candidates.some((row) => row.status === "queued" || row.status === "scoring") ? ALL_CANDIDATES_POLL_MS : false,
	});
}
