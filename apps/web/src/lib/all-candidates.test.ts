import { describe, expect, it } from "vitest";
import { allCandidatesPath, isFilteredView, validateAllCandidatesSearch } from "./all-candidates.ts";

describe("validateAllCandidatesSearch", () => {
	it("keeps every filter it can read and leaves defaults out", () => {
		expect(
			validateAllCandidatesSearch({
				q: "  ada ",
				jobId: "job_1",
				decision: "review",
				status: "reading",
				minScore: "70",
				sort: "job",
				page: "3",
			}),
		).toEqual({ q: "ada", jobId: "job_1", decision: "review", status: "reading", minScore: 70, sort: "job", page: 3 });
		expect(validateAllCandidatesSearch({ decision: "all", status: "any", sort: "score", page: 1 })).toEqual({
			q: undefined,
			jobId: undefined,
			decision: undefined,
			status: undefined,
			minScore: undefined,
			sort: undefined,
			page: undefined,
		});
	});

	it("drops what it can't read, so a bad link shows the plain list", () => {
		const search = validateAllCandidatesSearch({
			q: { text: "ada" },
			jobId: "x".repeat(101),
			decision: "maybe",
			status: "done",
			minScore: "60",
			sort: "rank",
			page: "1.5",
		});
		expect(Object.values(search).every((value) => value === undefined)).toBe(true);
		expect(validateAllCandidatesSearch({ page: -2, minScore: 85 })).toMatchObject({ page: undefined, minScore: 85 });
	});

	it("keeps a search the router read as a number, such as a phone number from a link", () => {
		expect(validateAllCandidatesSearch({ q: 12345, jobId: 42 })).toMatchObject({ q: "12345", jobId: "42" });
	});

	it("cuts a long search to 100 characters", () => {
		expect(validateAllCandidatesSearch({ q: "a".repeat(150) }).q).toHaveLength(100);
	});
});

describe("allCandidatesPath", () => {
	it("asks for the defaults with a bare path, and puts the rest in the query", () => {
		expect(allCandidatesPath({})).toBe("/candidates");
		expect(allCandidatesPath({ page: 1 })).toBe("/candidates");
		expect(
			allCandidatesPath({ q: "a&b", jobId: "j1", decision: "rejected", status: "failed", minScore: 50, sort: "name", page: 2 }),
		).toBe("/candidates?q=a%26b&jobId=j1&decision=rejected&status=failed&minScore=50&sort=name&page=2");
	});
});

describe("isFilteredView", () => {
	it("counts what narrows the list, not the sort or the page", () => {
		expect(isFilteredView({})).toBe(false);
		expect(isFilteredView({ sort: "newest", page: 2 })).toBe(false);
		expect(isFilteredView({ minScore: 50 })).toBe(true);
		expect(isFilteredView({ decision: "review" })).toBe(true);
	});
});
