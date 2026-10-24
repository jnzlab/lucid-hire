import { defaultStringifySearch } from "@tanstack/react-router";
import { SORTS, type SortKey, visibleCandidates } from "../../lib/candidate-list.ts";
import { type CandidateSummary, isWorking } from "../../lib/candidates.ts";

// What the job page's Candidates tab is showing, kept in the address so a link, a reload or Back brings back the same
// view: the tab (Candidates by default, or Requirements or Description), the selected candidate (`c`), the filter (`show`), the search (`q`) and the sort. Defaults are left
// out of the address. The candidate page reads `show`, `q` and `sort` too, so its previous and next follow the list
// the recruiter came from.

// "To review" is scored and undecided, "Reading" is queued or being scored; the decisions go by the decision alone
// and "Failed" by the status alone (the same rules as the API's counts).
export const SHOW_FILTERS = ["all", "review", "shortlisted", "rejected", "reading", "failed"] as const;
export type ShowFilter = (typeof SHOW_FILTERS)[number];
export const SHOW_LABEL: Record<ShowFilter, string> = {
	all: "All",
	review: "To review",
	shortlisted: "Shortlisted",
	rejected: "Not a fit",
	reading: "Reading",
	failed: "Failed",
};
// What an empty filter says, when nothing else narrows the list.
export const SHOW_EMPTY: Record<Exclude<ShowFilter, "all">, string> = {
	review: "Nothing to review. Every scored CV has a decision.",
	shortlisted: "No shortlisted candidates yet.",
	rejected: "No candidates marked Not a fit yet.",
	reading: "No CVs are being read right now.",
	failed: "No CVs failed. Every upload was read.",
};

// The job page offers three orders (spec §4.4); the candidate page's previous and next know the same three.
export const JOB_SORTS = ["best", "newest", "name"] as const satisfies readonly SortKey[];
export type JobSort = (typeof JOB_SORTS)[number];
export const JOB_SORT_OPTIONS = SORTS.filter(({ value }) => (JOB_SORTS as readonly SortKey[]).includes(value)) as {
	value: JobSort;
	label: string;
}[];
export const SORT_LABEL = Object.fromEntries(SORTS.map(({ value, label }) => [value, label])) as Record<SortKey, string>;

export const CANDIDATE_QUERY_MAX = 100;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export const JOB_TABS = ["requirements", "description"] as const;
export type JobTab = "candidates" | (typeof JOB_TABS)[number];

export type JobSearch = {
	tab?: Exclude<JobTab, "candidates">;
	c?: string;
	show?: Exclude<ShowFilter, "all">;
	q?: string;
	sort?: Exclude<JobSort, "best">;
};
export type JobView = { show: ShowFilter; q: string; sort: JobSort };

// The router parses a value that looks like JSON ("123", "true"), so a search or an id can arrive as a number.
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

// The route's validateSearch: anything unreadable is dropped, so a bad link shows the plain list.
export function validateJobSearch(search: Record<string, unknown>): JobSearch {
	const q = text(search.q).trim().slice(0, CANDIDATE_QUERY_MAX);
	const c = text(search.c);
	return {
		tab: JOB_TABS.find((tab) => tab === search.tab),
		c: ID_PATTERN.test(c) ? c : undefined,
		show: SHOW_FILTERS.find((show) => show !== "all" && show === search.show) as JobSearch["show"],
		q: q || undefined,
		sort: JOB_SORTS.find((sort) => sort !== "best" && sort === search.sort) as JobSearch["sort"],
	};
}

export const viewOf = ({ show, q, sort }: Pick<JobSearch, "show" | "q" | "sort">): JobView => ({
	show: show ?? "all",
	q: q ?? "",
	sort: sort ?? "best",
});

// The part of the search a link to a candidate keeps, so Back (and the candidate page's previous and next) follow it.
export function viewSearch({ show, q, sort }: Pick<JobSearch, "show" | "q" | "sort">): Pick<JobSearch, "show" | "q" | "sort"> {
	return { show, q: q?.trim() || undefined, sort };
}

// "/dashboard/jobs/j1/candidates/c1?show=review", written the way the router writes a search.
export function candidatePath(jobId: string, candidateId: string, search: Pick<JobSearch, "show" | "q" | "sort"> = {}) {
	const kept = Object.fromEntries(Object.entries(viewSearch(search)).filter(([, value]) => value !== undefined));
	return `/dashboard/jobs/${jobId}/candidates/${candidateId}${defaultStringifySearch(kept)}`;
}

export function matchesShow(candidate: Pick<CandidateSummary, "status" | "decision">, show: ShowFilter): boolean {
	switch (show) {
		case "all":
			return true;
		case "review":
			return candidate.status === "scored" && candidate.decision === "undecided";
		case "reading":
			return isWorking(candidate);
		case "failed":
			return candidate.status === "failed";
		default:
			return candidate.decision === show;
	}
}

// How many CVs each filter would show. They count the whole list: the search doesn't change them.
export function showCounts(list: CandidateSummary[]): Record<ShowFilter, number> {
	const counts = Object.fromEntries(SHOW_FILTERS.map((show) => [show, 0])) as Record<ShowFilter, number>;
	for (const candidate of list) {
		for (const show of SHOW_FILTERS) if (matchesShow(candidate, show)) counts[show] += 1;
	}
	return counts;
}

// The rows to list, in order. The filter and search only hide rows (a rank belongs to the CV, so nothing is
// renumbered), and every sort keeps CVs without a score after the scored ones (lib/candidate-list.ts).
export function visibleRows(list: CandidateSummary[], { show, q, sort }: JobView): CandidateSummary[] {
	const rows = show === "all" ? list : list.filter((candidate) => matchesShow(candidate, show));
	return visibleCandidates(rows, { query: q, status: "all", decision: "all", sort });
}

export const isFilteredView = ({ show, q }: JobView) => show !== "all" || q.trim() !== "";
