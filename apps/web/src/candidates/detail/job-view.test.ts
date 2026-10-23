import { describe, expect, it } from "vitest";
import type { CandidateSummary } from "../../lib/candidates.ts";
import { jobHref, placeIn, validateCandidateSearch } from "./job-view.ts";

// A CV as the job's list has it. Anything not given is a scored CV nobody has decided on.
const row = (fields: Partial<CandidateSummary> & { id: string }): CandidateSummary => ({
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
	summary: null,
	hasNote: false,
	source: "upload",
	email: null,
	profile: null,
	error: null,
	canRetry: false,
	createdAt: "2026-10-22T12:00:00Z",
	scoredAt: null,
	...fields,
});

// The API's order: scored best first, then the ones being read, then the failed.
const list = [
	row({ id: "grace", name: "Grace Turner", score: 93, rank: 1, decision: "shortlisted", createdAt: "2026-10-22T12:01:00Z" }),
	row({ id: "kenji", name: "Kenji Tanaka", score: 80, rank: 2, createdAt: "2026-10-22T12:05:00Z" }),
	row({ id: "amara", name: "Amara Okafor", score: 71, rank: 3, decision: "rejected", createdAt: "2026-10-22T12:03:00Z" }),
	row({ id: "ben", name: "Ben Carter", score: 64, rank: 4, summary: "Swift for two years.", createdAt: "2026-10-22T12:02:00Z" }),
	row({ id: "wait", status: "scoring", createdAt: "2026-10-22T12:06:00Z" }),
	row({ id: "bad", status: "failed", createdAt: "2026-10-22T12:00:00Z" }),
];

describe("the job page's view, for previous and next", () => {
	it("reads show, q and sort from the address with the job page's rules, and keeps nothing else", () => {
		expect(validateCandidateSearch({ show: "review", q: "  swift ", sort: "name", c: "grace", tab: "description" })).toEqual({
			show: "review",
			q: "swift",
			sort: "name",
		});
		expect(validateCandidateSearch({ show: "all", q: "   ", sort: "best" })).toEqual({});
		expect(validateCandidateSearch({ show: "everything", sort: "lowest", q: ["x"] })).toEqual({});
		// The router reads "123" as a number.
		expect(validateCandidateSearch({ q: 123 })).toEqual({ q: "123" });
		expect(validateCandidateSearch({ q: "x".repeat(150) }).q).toHaveLength(100);
	});

	it("writes the view into the link back to the job", () => {
		expect(jobHref("job_1")).toBe("/dashboard/jobs/job_1");
		expect(jobHref("job_1", { show: "review", q: "swift" })).toBe("/dashboard/jobs/job_1?show=review&q=swift");
		expect(jobHref("job_1", { sort: "name" })).toBe("/dashboard/jobs/job_1?sort=name");
	});

	it("walks the rows in the job page's order for each filter, search and sort", () => {
		// Follows "next" from the first row of the view.
		const walk = (search: Parameters<typeof placeIn>[1], first: string) => {
			const ids: string[] = [];
			for (let id: string | null = first; id; id = placeIn(list, search, id)?.next ?? null) ids.push(id);
			return ids;
		};
		expect(walk({}, "grace")).toEqual(["grace", "kenji", "amara", "ben", "wait", "bad"]);
		expect(walk({ show: "review" }, "kenji")).toEqual(["kenji", "ben"]);
		expect(walk({ show: "shortlisted" }, "grace")).toEqual(["grace"]);
		expect(walk({ show: "rejected" }, "amara")).toEqual(["amara"]);
		expect(walk({ show: "reading" }, "wait")).toEqual(["wait"]);
		expect(walk({ show: "failed" }, "bad")).toEqual(["bad"]);
		// The search reads the summary too.
		expect(walk({ q: "swift" }, "ben")).toEqual(["ben"]);
		// Whatever the sort, CVs without a score come after the scored ones.
		expect(walk({ sort: "name" }, "amara").slice(0, 4)).toEqual(["amara", "ben", "grace", "kenji"]);
		expect(walk({ sort: "newest" }, "kenji").slice(0, 4)).toEqual(["kenji", "amara", "ben", "grace"]);
	});

	it("gives a candidate's place with the one before and after it", () => {
		expect(placeIn(list, {}, "grace")).toEqual({ index: 0, total: 6, previous: null, next: "kenji" });
		expect(placeIn(list, {}, "amara")).toEqual({ index: 2, total: 6, previous: "kenji", next: "ben" });
		expect(placeIn(list, {}, "bad")).toEqual({ index: 5, total: 6, previous: "wait", next: null });
		expect(placeIn(list, { show: "review" }, "ben")).toEqual({ index: 1, total: 2, previous: "kenji", next: null });
		expect(placeIn(list, { sort: "name" }, "ben")).toEqual({ index: 1, total: 6, previous: "amara", next: "grace" });
	});

	it("keeps the open candidate in its place when the view would now leave it out", () => {
		// Kenji was just shortlisted under "To review": the count doesn't jump, and next is still Ben.
		const decided = list.map((c) => (c.id === "kenji" ? { ...c, decision: "shortlisted" as const } : c));
		expect(placeIn(decided, { show: "review" }, "kenji")).toEqual({ index: 0, total: 2, previous: null, next: "ben" });
		// Once on Ben, Kenji has left the list.
		expect(placeIn(decided, { show: "review" }, "ben")).toEqual({ index: 0, total: 1, previous: null, next: null });
	});

	it("has no place for a candidate the job's list doesn't have", () => {
		expect(placeIn(list, {}, "missing")).toBeNull();
	});
});
