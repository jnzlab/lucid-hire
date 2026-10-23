import { defaultStringifySearch } from "@tanstack/react-router";
import { type JobSearch, validateJobSearch, viewOf, viewSearch, visibleRows } from "../../jobs/workspace/view.ts";
import type { CandidateSummary } from "../../lib/candidates.ts";

// The job page's filter, search and sort (`show`, `q`, `sort`), which the candidate page carries in its address so
// its previous and next follow the list the recruiter came from, and the way back returns to it. The rules are the
// job page's own (jobs/workspace/view.ts), so the two can never disagree.
// `from=candidates` says the candidate was opened from the All candidates list, so the way back goes there instead.
export type CandidateSearch = Pick<JobSearch, "show" | "q" | "sort"> & { from?: "candidates" };

// The candidate route's validateSearch: the job page's validation, keeping only the view, plus where it came from.
export const validateCandidateSearch = (search: Record<string, unknown>): CandidateSearch => ({
	...viewSearch(validateJobSearch(search)),
	from: search.from === "candidates" ? "candidates" : undefined,
});

// "/dashboard/jobs/j1?show=review", written the way the router writes a search.
export function jobHref(jobId: string, search: CandidateSearch = {}) {
	const kept = Object.fromEntries(Object.entries(viewSearch(search)).filter(([, value]) => value !== undefined));
	return `/dashboard/jobs/${jobId}${defaultStringifySearch(kept)}`;
}

export type Place = { index: number; total: number; previous: string | null; next: string | null };

// Where a candidate sits in the job page's list for this view, and who comes before and after it. A candidate the
// view would now leave out (one just shortlisted under "To review") keeps its place while it is open, so the count
// doesn't jump under the recruiter; it drops out once they move on. Null when the candidate isn't in the job's list.
export function placeIn(list: CandidateSummary[], search: CandidateSearch, id: string): Place | null {
	const view = viewOf(search);
	const kept = new Set(visibleRows(list, view).map((c) => c.id));
	kept.add(id);
	// Every CV in this sort, before any filter. The sorts are stable and fall back to the rank, so the filtered rows
	// keep this order.
	const rows = visibleRows(list, { ...view, show: "all", q: "" }).filter((c) => kept.has(c.id));
	const index = rows.findIndex((c) => c.id === id);
	if (index === -1) return null;
	return {
		index,
		total: rows.length,
		previous: rows[index - 1]?.id ?? null,
		next: rows[index + 1]?.id ?? null,
	};
}
