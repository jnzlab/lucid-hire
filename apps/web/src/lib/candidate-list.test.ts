import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, type ListView, type SortKey, isFiltered, visibleCandidates } from "./candidate-list.ts";
import type { CandidateSummary } from "./candidates.ts";

let created = 0;
// A candidate as the API lists it: scored ones come with a rank.
function candidate(fields: Partial<CandidateSummary> & { id: string }): CandidateSummary {
	created += 1;
	return {
		fileName: `${fields.id}.pdf`,
		status: "scored",
		decision: "undecided",
		name: null,
		headline: null,
		score: null,
		rank: null,
		matches: [],
		gaps: [],
		checks: [],
		scoredBeforeRequirements: false,
		checking: false,
		summary: null,
		hasNote: false,
		source: "upload",
		email: null,
		profile: null,
		error: null,
		canRetry: false,
		createdAt: new Date(Date.UTC(2026, 9, 22, 12, created)).toISOString(),
		scoredAt: null,
		...fields,
	};
}

// In the API's order: scored by rank, then being read, then failed.
const list = [
	candidate({ id: "ada", name: "Ada Lovelace", score: 90, rank: 1, headline: "Swift engineer", summary: "Loves compilers." }),
	candidate({ id: "bo", name: "bo Chen", score: 70, rank: 2, profile: { email: "bo@example.com" } }),
	candidate({ id: "cy", name: "Cy Young", score: 50, rank: 3, decision: "shortlisted" }),
	candidate({ id: "wait", status: "queued", fileName: "queued.pdf" }),
	candidate({ id: "read", status: "scoring", fileName: "reading.pdf" }),
	candidate({ id: "bad", status: "failed", fileName: "aaa-broken.pdf" }),
];
const ids = (view: Partial<ListView>) => visibleCandidates(list, { ...DEFAULT_VIEW, ...view }).map(({ id }) => id);

describe("visibleCandidates", () => {
	it("keeps the API's order for Best match", () => {
		expect(ids({})).toEqual(["ada", "bo", "cy", "wait", "read", "bad"]);
	});

	it("keeps CVs without a score after the scored ones in every sort", () => {
		const unscored = new Set(["wait", "read", "bad"]);
		const sorts: SortKey[] = ["best", "lowest", "newest", "oldest", "name"];
		for (const sort of sorts) {
			const order = ids({ sort });
			const firstUnscored = order.findIndex((id) => unscored.has(id));
			expect(order.slice(firstUnscored).every((id) => unscored.has(id)), sort).toBe(true);
			expect(order).toHaveLength(6);
		}
	});

	it("sorts the scored by lowest score, newest, oldest and name, ignoring case", () => {
		expect(ids({ sort: "lowest" }).slice(0, 3)).toEqual(["cy", "bo", "ada"]);
		expect(ids({ sort: "newest" }).slice(0, 3)).toEqual(["cy", "bo", "ada"]);
		expect(ids({ sort: "oldest" }).slice(0, 3)).toEqual(["ada", "bo", "cy"]);
		expect(ids({ sort: "name" }).slice(0, 3)).toEqual(["ada", "bo", "cy"]);
	});

	it("puts the unscored in name or date order when sorting by those, the failed ones last", () => {
		expect(ids({ sort: "name" }).slice(3)).toEqual(["wait", "read", "bad"]);
		expect(ids({ sort: "newest" }).slice(3)).toEqual(["read", "wait", "bad"]);
	});

	it("searches name, email, headline and the AI summary, ignoring case and spaces around the query", () => {
		expect(ids({ query: "  LOVELACE " })).toEqual(["ada"]);
		expect(ids({ query: "bo@example" })).toEqual(["bo"]);
		expect(ids({ query: "swift engineer" })).toEqual(["ada"]);
		expect(ids({ query: "compilers" })).toEqual(["ada"]);
		expect(ids({ query: "broken" })).toEqual(["bad"]);
		expect(ids({ query: "nobody" })).toEqual([]);
	});

	it("combines search, status and decision", () => {
		expect(ids({ status: "scored" })).toEqual(["ada", "bo", "cy"]);
		expect(ids({ status: "queued" })).toEqual(["wait"]);
		expect(ids({ status: "scoring" })).toEqual(["read"]);
		expect(ids({ status: "failed" })).toEqual(["bad"]);
		expect(ids({ decision: "shortlisted" })).toEqual(["cy"]);
		expect(ids({ status: "scored", query: "chen" })).toEqual(["bo"]);
		expect(ids({ status: "failed", query: "chen" })).toEqual([]);
		expect(ids({ status: "scored", decision: "shortlisted", query: "ada" })).toEqual([]);
	});

	it("never changes a rank", () => {
		const ranks = visibleCandidates(list, { ...DEFAULT_VIEW, query: "cy" }).map(({ rank }) => rank);
		expect(ranks).toEqual([3]);
	});
});

describe("isFiltered", () => {
	it("is true when a search, status or decision hides rows, not for a sort", () => {
		expect(isFiltered(DEFAULT_VIEW)).toBe(false);
		expect(isFiltered({ ...DEFAULT_VIEW, sort: "name" })).toBe(false);
		expect(isFiltered({ ...DEFAULT_VIEW, query: " " })).toBe(false);
		expect(isFiltered({ ...DEFAULT_VIEW, query: "a" })).toBe(true);
		expect(isFiltered({ ...DEFAULT_VIEW, status: "failed" })).toBe(true);
		expect(isFiltered({ ...DEFAULT_VIEW, decision: "rejected" })).toBe(true);
	});
});
