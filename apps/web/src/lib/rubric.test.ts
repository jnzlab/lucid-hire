import type { RubricItem } from "@lucid-hire/scoring";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api.ts";
import type { Candidate, CandidateList, CandidateSummary } from "./candidates.ts";
import {
	applyChanges,
	changesNothing,
	checkDetail,
	checkLabel,
	movesBetween,
	needsCheck,
	rerank,
	rescoreCandidate,
	rescoreList,
	rescoreRow,
	rubricErrorMessage,
	squareLabel,
	squash,
} from "./rubric.ts";

const rubric: RubricItem[] = [
	{ id: "r1", label: "Swift", detail: "Several years of Swift in production", weight: "must" },
	{ id: "r2", label: "SwiftUI", detail: "Shipped a live app with SwiftUI", weight: "must" },
	{ id: "r3", label: "Kotlin MP", detail: "Code shared with Android", weight: "nice" },
	{ id: "r0", label: "Objective-C", detail: "Maintained Objective-C code", weight: "nice", removed: true },
];

// A scored CV with a level for each requirement (r1, r2, r3), scored and ranked as the API would have it.
function row(id: string, levels: [string | null, string | null, string | null], fields: Partial<CandidateSummary> = {}): CandidateSummary {
	const checks = rubric
		.filter((item) => !item.removed)
		.map(({ id: requirement, label, weight }, index) => ({ id: requirement, label, weight, level: levels[index] as never }));
	return {
		id,
		fileName: `${id}.pdf`,
		status: "scored",
		decision: "undecided",
		name: id,
		headline: null,
		score: null,
		rank: null,
		matches: [],
		gaps: [],
		checks,
		scoredBeforeRequirements: false,
		checking: false,
		summary: null,
		hasNote: false,
		source: "upload",
		email: null,
		profile: null,
		error: null,
		canRetry: false,
		createdAt: "2026-10-22T12:00:00Z",
		scoredAt: `2026-10-22T12:0${id.length}:00Z`,
		...fields,
	};
}

// Grace 86, Kenji 79, Rayan 36 with Kotlin MP as a nice-to-have.
const grace = row("grace", ["clear", "clear", "none"]);
const kenji = row("kenji", ["clear", "partial", "clear"]);
const rayan = row("rayan", ["partial", "none", "clear"]);
const list = (rows: CandidateSummary[]): CandidateList => ({ candidates: rows, cvCount: rows.length, cvLimit: 10 });
const order = (result: CandidateList) => result.candidates.map(({ id, score, rank }) => [id, score, rank]);

describe("applyChanges and squash", () => {
	it("changes weights, labels and removals by id, and leaves the rest alone", () => {
		const next = applyChanges(rubric, [{ id: "r3", weight: "must" }, { id: "r1", label: "  Swift 5 " }, { id: "r2", removed: true }]);
		expect(next.map(({ id, label, weight, removed }) => [id, label, weight, removed ?? false])).toEqual([
			["r1", "Swift 5", "must", false],
			["r2", "SwiftUI", "must", true],
			["r3", "Kotlin MP", "must", false],
			["r0", "Objective-C", "nice", true],
		]);
		expect(rubric[2].weight).toBe("nice");
	});

	it("folds changes to the same requirement into one, the last winning, in the order they were first made", () => {
		expect(
			squash([{ id: "r3", weight: "must" }, { id: "r1", weight: "off" }, { id: "r3", weight: "off" }, { id: "r3", label: "KMP" }]),
		).toEqual([
			{ id: "r3", weight: "off", label: "KMP" },
			{ id: "r1", weight: "off" },
		]);
	});

	it("knows a change that ends where the requirement already is", () => {
		expect(changesNothing({ id: "r3", weight: "nice" }, rubric)).toBe(true);
		expect(changesNothing({ id: "r1", label: " Swift " }, rubric)).toBe(true);
		expect(changesNothing({ id: "r3", weight: "must" }, rubric)).toBe(false);
		expect(changesNothing({ id: "r2", removed: true }, rubric)).toBe(false);
		expect(changesNothing({ id: "r9", weight: "must" }, rubric)).toBe(false);
	});
});

describe("rescoreList", () => {
	it("re-scores every row with the shared formula and re-ranks them by THE order", () => {
		const posted = rescoreList(list([kenji, rayan, grace]), rubric);
		expect(order(posted)).toEqual([
			["grace", 86, 1],
			["kenji", 79, 2],
			["rayan", 36, 3],
		]);

		const kotlinMust = rescoreList(posted, applyChanges(rubric, [{ id: "r3", weight: "must" }]));
		expect(order(kotlinMust)).toEqual([
			["kenji", 83, 1],
			["grace", 67, 2],
			["rayan", 50, 3],
		]);
		const [top] = kotlinMust.candidates;
		expect(top.checks.map(({ weight }) => weight)).toEqual(["must", "must", "must"]);
		expect(top.matches).toEqual(["Swift", "Kotlin MP"]);
		expect(top.gaps).toEqual([]);
		expect(kotlinMust.candidates[1].gaps).toEqual(["Kotlin MP"]);
	});

	it("leaves every row unranked when nothing counts", () => {
		const allOff = applyChanges(rubric, ["r1", "r2", "r3"].map((id) => ({ id, weight: "off" as const })));
		expect(order(rescoreList(list([grace, kenji]), allOff))).toEqual([
			["grace", null, null],
			["kenji", null, null],
		]);
	});

	it("gives a new requirement no level on every row, so it counts as none until checked", () => {
		const added = [...rubric, { id: "r5", label: "Accessibility", detail: "VoiceOver", weight: "must" as const }];
		const [first] = rescoreList(list([grace]), added).candidates;
		expect(first.checks.at(-1)).toEqual({ id: "r5", label: "Accessibility", weight: "must", level: null });
		expect(first.score).toBe(60);
		expect(first.gaps).toEqual(["Accessibility"]);
		expect(needsCheck(first)).toBe(true);
		expect(needsCheck({ ...first, checking: true })).toBe(false);
		expect(needsCheck(grace)).toBe(false);
	});

	it("keeps the score of a CV scored before requirements, and still ranks it among the others", () => {
		const legacy = row("old", [null, null, null], { checks: [], score: 80, scoredBeforeRequirements: true });
		expect(rescoreRow(legacy, rubric)).toBe(legacy);
		expect(order(rescoreList(list([legacy, grace, kenji]), rubric))).toEqual([
			["grace", 86, 1],
			["old", 80, 2],
			["kenji", 79, 3],
		]);
	});

	it("keeps CVs still being read and failed ones after the scored, in their order", () => {
		const reading = row("reading", [null, null, null], { status: "queued", checks: [] });
		const failed = row("failed", [null, null, null], { status: "failed", checks: [] });
		const scored = rescoreList(list([kenji, grace]), rubric).candidates.reverse();
		expect(rerank([reading, scored[0], failed, scored[1]]).map(({ id, rank }) => [id, rank])).toEqual([
			["grace", 1],
			["kenji", 2],
			["reading", null],
			["failed", null],
		]);
	});

	it("breaks a tie by who was scored first", () => {
		const twin = row("ana", ["clear", "clear", "none"], { scoredAt: "2026-10-22T11:00:00Z" });
		expect(rescoreList(list([grace, twin]), rubric).candidates.map(({ id }) => id)).toEqual(["ana", "grace"]);
	});
});

describe("movesBetween", () => {
	it("says how far each ranked row moved, and nothing for rows that gained or lost a rank", () => {
		const before = rescoreList(list([grace, kenji, rayan]), rubric).candidates;
		const after = rescoreList(list(before), applyChanges(rubric, [{ id: "r3", weight: "must" }])).candidates;
		expect([...movesBetween(before, after)]).toEqual([
			["kenji", 1],
			["grace", -1],
		]);
		const unranked = after.map((candidate) => ({ ...candidate, rank: null }));
		expect(movesBetween(before, unranked).size).toBe(0);
	});
});

describe("rescoreCandidate", () => {
	it("moves the candidate page's evidence, score and rank with the requirements", () => {
		const candidate = {
			...kenji,
			profile: null,
			rankedCount: 3,
			rank: 2,
			evidence: [
				{ id: "r1", label: "Swift", detail: "Several years of Swift in production", weight: "must", level: "clear", quote: "6 years" },
				{ id: "r2", label: "SwiftUI", detail: "Shipped a live app with SwiftUI", weight: "must", level: "partial", quote: "A prototype" },
				{ id: "r3", label: "Kotlin MP", detail: "Code shared with Android", weight: "nice", level: "clear", quote: "KMP module" },
			],
			legacyRequirements: null,
			fileSize: 1,
			note: null,
			decidedAt: null,
			decidedBy: null,
		} satisfies Candidate;
		const next = applyChanges(rubric, [{ id: "r3", weight: "must", label: "KMP" }, { id: "r2", removed: true }]);
		const ranked = rescoreList(list([grace, kenji, rayan]), next);
		const page = rescoreCandidate(candidate, next, ranked);
		expect(page.evidence?.map(({ id, label, weight, quote }) => [id, label, weight, quote])).toEqual([
			["r1", "Swift", "must", "6 years"],
			["r3", "KMP", "must", "KMP module"],
		]);
		expect(page.score).toBe(100);
		expect([page.rank, page.rankedCount]).toEqual([1, 3]);
	});
});

describe("the words", () => {
	it("checks labels and details by the API's rules", () => {
		expect(checkLabel("   ")).toBe("Enter a name for this requirement");
		expect(checkLabel("x".repeat(41))).toBe("Keep the name to 40 characters");
		expect(checkLabel("  Swift  ")).toBeNull();
		expect(checkDetail("")).toBe("Say what a CV should show for this requirement");
		expect(checkDetail("x".repeat(301))).toBe("Keep it to 300 characters");
	});

	it("names each square for screen readers", () => {
		expect(squareLabel({ label: "SwiftUI", level: "partial", weight: "must" })).toBe("SwiftUI: partial");
		expect(squareLabel({ label: "Kotlin MP", level: null, weight: "nice" })).toBe("Kotlin MP: not checked");
		expect(squareLabel({ label: "GraphQL", level: "clear", weight: "off" })).toBe("GraphQL: clear, off");
	});

	it("words every error code the requirements endpoints answer with", () => {
		const message = (code: string, fields = {}) => rubricErrorMessage(new ApiError(409, "From the API.", code, fields));
		expect(message("job_not_found")).toMatch(/doesn't exist any more/);
		expect(message("rubric_not_ready")).toMatch(/can't be changed right now/);
		expect(message("rubric_drafting")).toMatch(/already being drafted/);
		expect(message("unknown_requirement")).toMatch(/isn't on this job any more/);
		expect(message("rubric_empty")).toMatch(/at least one requirement/);
		expect(message("rubric_full")).toMatch(/already has 15 requirements/);
		expect(message("invalid_input", { label: "Enter a label" })).toBe("Enter a label");
		// The API's own words for the AI limits, which already say when to try again.
		expect(message("rate_limited")).toBe("From the API.");
		expect(message("plan_limit")).toBe("From the API.");
		expect(rubricErrorMessage(new Error("Offline"))).toBe("Offline");
	});
});
