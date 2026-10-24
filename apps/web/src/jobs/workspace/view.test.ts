import { describe, expect, it } from "vitest";
import type { CandidateSummary } from "../../lib/candidates.ts";
import { capacityOf } from "./capacity.ts";
import { candidatePath, isFilteredView, showCounts, validateJobSearch, viewOf, visibleRows } from "./view.ts";

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
	candidate({ id: "ada", name: "Ada Lovelace", score: 90, rank: 1, decision: "shortlisted" }),
	candidate({ id: "bo", name: "Bo Chen", score: 70, rank: 2, summary: "Knows Kotlin." }),
	candidate({ id: "cy", name: "Cy Young", score: 50, rank: 3, decision: "rejected" }),
	candidate({ id: "dee", name: "Dee Park", score: 40, rank: 4 }),
	candidate({ id: "wait", status: "queued", fileName: "queued.pdf" }),
	candidate({ id: "read", status: "scoring", fileName: "reading.pdf" }),
	candidate({ id: "bad", status: "failed", fileName: "broken.pdf", decision: "rejected" }),
];
const ids = (rows: CandidateSummary[]) => rows.map(({ id }) => id);

describe("validateJobSearch", () => {
	it("keeps what it knows and leaves the defaults out", () => {
		expect(validateJobSearch({ tab: "description", c: "cand_1", show: "review", q: " swift ", sort: "name" })).toEqual({
			tab: "description",
			c: "cand_1",
			show: "review",
			q: "swift",
			sort: "name",
		});
		expect(validateJobSearch({ tab: "requirements" }).tab).toBe("requirements");
		expect(validateJobSearch({ tab: "candidates", show: "all", sort: "best", q: "   " })).toEqual({
			tab: undefined,
			c: undefined,
			show: undefined,
			q: undefined,
			sort: undefined,
		});
	});

	it("drops values it doesn't know, so a bad link shows the plain list", () => {
		expect(validateJobSearch({ tab: "notes", c: "<script>", show: "maybe", sort: "lowest" })).toEqual({
			tab: undefined,
			c: undefined,
			show: undefined,
			q: undefined,
			sort: undefined,
		});
		expect(validateJobSearch({ c: ["a"], q: { text: "x" } })).toEqual(expect.objectContaining({ c: undefined, q: undefined }));
	});

	it("takes a search or an id that the router read as a number, and caps a long search", () => {
		expect(validateJobSearch({ q: 2024, c: 42 })).toEqual(expect.objectContaining({ q: "2024", c: "42" }));
		expect(validateJobSearch({ q: "x".repeat(150) }).q).toHaveLength(100);
	});
});

describe("showCounts", () => {
	it("counts each filter over the whole list", () => {
		expect(showCounts(list)).toEqual({ all: 7, review: 2, shortlisted: 1, rejected: 2, reading: 2, failed: 1 });
		expect(showCounts([])).toEqual({ all: 0, review: 0, shortlisted: 0, rejected: 0, reading: 0, failed: 0 });
	});
});

describe("visibleRows", () => {
	it("filters without renumbering, and searches inside the filter", () => {
		expect(ids(visibleRows(list, viewOf({})))).toEqual(ids(list));
		// To review: scored and undecided only, so a CV being read isn't in it yet.
		expect(ids(visibleRows(list, viewOf({ show: "review" })))).toEqual(["bo", "dee"]);
		expect(ids(visibleRows(list, viewOf({ show: "rejected" })))).toEqual(["cy", "bad"]);
		expect(ids(visibleRows(list, viewOf({ show: "reading" })))).toEqual(["wait", "read"]);
		expect(ids(visibleRows(list, viewOf({ show: "failed" })))).toEqual(["bad"]);
		expect(ids(visibleRows(list, viewOf({ show: "review", q: "kotlin" })))).toEqual(["bo"]);
		expect(visibleRows(list, viewOf({ show: "review" }))[1].rank).toBe(4);
	});

	it("sorts, keeping CVs without a score after the scored ones", () => {
		expect(ids(visibleRows(list, viewOf({ sort: "name" }))).slice(0, 4)).toEqual(["ada", "bo", "cy", "dee"]);
		expect(ids(visibleRows(list, viewOf({ sort: "newest" }))).slice(0, 4)).toEqual(["dee", "cy", "bo", "ada"]);
	});

	it("says when the view is narrowed", () => {
		expect(isFilteredView(viewOf({}))).toBe(false);
		expect(isFilteredView(viewOf({ sort: "name" }))).toBe(false);
		expect(isFilteredView(viewOf({ show: "failed" }))).toBe(true);
		expect(isFilteredView(viewOf({ q: "ada" }))).toBe(true);
	});
});

describe("candidatePath", () => {
	it("keeps the view, so Back and the candidate page's previous and next follow it", () => {
		expect(candidatePath("job_1", "cand_1")).toBe("/dashboard/jobs/job_1/candidates/cand_1");
		expect(candidatePath("job_1", "cand_1", { show: "review", q: " swift dev ", sort: "name" })).toBe(
			"/dashboard/jobs/job_1/candidates/cand_1?show=review&q=swift+dev&sort=name",
		);
	});
});

describe("capacityOf", () => {
	it("says why a job can't take CVs, and whether upgrading would help", () => {
		expect(capacityOf({ status: "open", cvCount: 3 }, { cvCount: 4, cvLimit: 10 })).toEqual(
			expect.objectContaining({ used: 4, slotsLeft: 6, note: null, full: false, usage: "4 of 10 free CVs used" }),
		);
		expect(capacityOf({ status: "open", cvCount: 10 }, { cvCount: 10, cvLimit: 10 })).toEqual(
			expect.objectContaining({ full: true, upgradable: true, note: "This job has used its 10 free CVs." }),
		);
		expect(capacityOf({ status: "draft", cvCount: 0 }, undefined).note).toMatch(/^This job is a draft/);
		expect(capacityOf({ status: "closed", cvCount: 0 }, undefined).note).toMatch(/^This job is closed/);
	});

	it("never calls a job full before its plan's limit is known", () => {
		expect(capacityOf({ status: "open", cvCount: 20 }, undefined)).toEqual(
			expect.objectContaining({ full: false, upgradable: false, note: null, usage: "20 CVs" }),
		);
	});
});
