import { type CandidateStatus, type CandidateSummary, type Decision, candidateEmail, candidateName } from "./candidates.ts";

export type StatusFilter = "all" | CandidateStatus;
export type SortKey = "best" | "lowest" | "newest" | "oldest" | "name";

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "scored", label: "Scored" },
	{ value: "queued", label: "Queued" },
	{ value: "scoring", label: "Scoring" },
	{ value: "failed", label: "Failed" },
];
export const SORTS: { value: SortKey; label: string }[] = [
	{ value: "best", label: "Best match" },
	{ value: "lowest", label: "Lowest score" },
	{ value: "newest", label: "Newest" },
	{ value: "oldest", label: "Oldest" },
	{ value: "name", label: "Name A–Z" },
];

export type ListView = { query: string; status: StatusFilter; decision: "all" | Decision; sort: SortKey };
export const DEFAULT_VIEW: ListView = { query: "", status: "all", decision: "all", sort: "best" };

// What a search looks in: name, file name, email, headline and the AI summary.
const haystack = (c: CandidateSummary) =>
	[candidateName(c), c.fileName, candidateEmail(c), c.headline, c.summary].filter(Boolean).join("\n").toLowerCase();

const byRank = (a: CandidateSummary, b: CandidateSummary) => (a.rank ?? 0) - (b.rank ?? 0);
const time = (c: CandidateSummary) => Date.parse(c.createdAt);
const name = (a: CandidateSummary, b: CandidateSummary) =>
	candidateName(a).localeCompare(candidateName(b), "en-GB", { sensitivity: "base" });

// How two CVs of the same kind compare in this sort. Ties fall back to the API's order, which is the rank.
const COMPARE: Record<SortKey, (a: CandidateSummary, b: CandidateSummary) => number> = {
	best: byRank,
	lowest: (a, b) => (a.score ?? 0) - (b.score ?? 0) || byRank(a, b),
	newest: (a, b) => time(b) - time(a) || byRank(a, b),
	oldest: (a, b) => time(a) - time(b) || byRank(a, b),
	name: (a, b) => name(a, b) || byRank(a, b),
};

const isRanked = (c: CandidateSummary) => c.status === "scored" && c.score !== null;
// Within the CVs that have no score: the ones being read, then the failed ones.
const unscoredGroup = (c: CandidateSummary) => (c.status === "failed" ? 1 : 0);

// The rows to show: searched, filtered and sorted. Whatever the sort, CVs without a score (still being read, or
// failed) come after the scored ones, so a "Lowest score" sort doesn't put a failed CV first. The list is the API's
// order on the way in (scored by rank, then being read, then failed), which is what "Best match" keeps.
export function visibleCandidates(list: CandidateSummary[], { query, status, decision, sort }: ListView) {
	const needle = query.trim().toLowerCase();
	const rows = list.filter(
		(c) =>
			(status === "all" || c.status === status) &&
			(decision === "all" || c.decision === decision) &&
			(needle === "" || haystack(c).includes(needle)),
	);
	const scored = rows.filter(isRanked).toSorted(COMPARE[sort]);
	const unscored = rows.filter((c) => !isRanked(c));
	// Score sorts have nothing to say about a CV without one, so those keep the API's order.
	const ordered =
		sort === "best" || sort === "lowest"
			? unscored
			: unscored.toSorted((a, b) => unscoredGroup(a) - unscoredGroup(b) || COMPARE[sort](a, b));
	return [...scored, ...ordered];
}

export const isFiltered = ({ query, status, decision }: ListView) =>
	query.trim() !== "" || status !== "all" || decision !== "all";
