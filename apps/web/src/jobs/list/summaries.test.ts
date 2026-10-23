import { describe, expect, it } from "vitest";
import { type PipelineCounts, cvsOnJob, firstName, pipelineLabel, pipelineSegments, statusSummary } from "./summaries.ts";

const counts = (fields: Partial<PipelineCounts> = {}): PipelineCounts => ({
	cvCount: 0,
	scoredCount: 0,
	toReviewCount: 0,
	shortlistedCount: 0,
	rejectedCount: 0,
	readingCount: 0,
	failedCount: 0,
	...fields,
});
// 20 CVs: 16 scored (9 to review, 3 shortlisted, 4 not a fit), 3 being read and 1 that failed.
const busy = counts({
	cvCount: 20,
	scoredCount: 16,
	toReviewCount: 9,
	shortlistedCount: 3,
	rejectedCount: 4,
	readingCount: 3,
	failedCount: 1,
});

describe("pipelineLabel", () => {
	it("says every part that has CVs, always with to review and shortlisted", () => {
		expect(pipelineLabel(busy)).toBe("9 to review, 3 shortlisted, 4 not a fit, 3 reading, 1 failed");
		expect(pipelineLabel(counts({ cvCount: 2, scoredCount: 2, toReviewCount: 2 }))).toBe("2 to review, 0 shortlisted");
	});

	it("tells a job that never had a CV from one whose CVs were all deleted", () => {
		expect(pipelineLabel(counts())).toBe("No CVs yet");
		expect(pipelineLabel(counts({ cvCount: 4 }))).toBe("No candidates");
	});

	it("writes big numbers with separators", () => {
		expect(pipelineLabel(counts({ cvCount: 1200, scoredCount: 1200, toReviewCount: 1200 }))).toBe("1,200 to review, 0 shortlisted");
	});
});

describe("pipelineSegments", () => {
	it("goes shortlisted, to review, reading, not a fit, and leaves out failed and empty parts", () => {
		expect(pipelineSegments(busy).map(({ key, count }) => [key, count])).toEqual([
			["shortlisted", 3],
			["review", 9],
			["reading", 3],
			["rejected", 4],
		]);
		expect(pipelineSegments(counts({ toReviewCount: 2, failedCount: 1 })).map((segment) => segment.key)).toEqual(["review"]);
		expect(pipelineSegments(counts())).toEqual([]);
	});
});

describe("cvsOnJob", () => {
	it("counts the CVs on the job now, not the ones ever uploaded", () => {
		expect(cvsOnJob(busy)).toBe(20);
		expect(cvsOnJob(counts({ cvCount: 5, scoredCount: 1, readingCount: 1 }))).toBe(2);
	});
});

describe("statusSummary", () => {
	it("names each status with jobs, a single draft as a draft", () => {
		expect(statusSummary({ all: 9, open: 5, draft: 2, closed: 2 })).toBe("5 open · 2 drafts · 2 closed");
		expect(statusSummary({ all: 2, open: 1, draft: 1, closed: 0 })).toBe("1 open · 1 draft");
	});

	it("is nothing when there are no jobs", () => {
		expect(statusSummary({ all: 0, open: 0, draft: 0, closed: 0 })).toBeNull();
	});
});

describe("firstName", () => {
	it("takes the first word of the name, and says Unnamed CV without one", () => {
		expect(firstName("  Grace   Turner ")).toBe("Grace");
		expect(firstName(null)).toBe("Unnamed CV");
		expect(firstName("   ")).toBe("Unnamed CV");
	});
});
