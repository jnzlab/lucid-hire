import { describe, expect, it } from "vitest";
import {
	type Check,
	type EvidenceMap,
	type RubricItem,
	compareRanked,
	gapLabels,
	matchLabels,
	nextRequirementId,
	scoreChecks,
	scoreEvidence,
	toChecks,
	uncheckedIds,
	weightedScore,
} from "./index.ts";

const rubric: RubricItem[] = [
	{ id: "r1", label: "Swift", detail: "Several years of Swift in production apps", weight: "must" },
	{ id: "r2", label: "SwiftUI", detail: "SwiftUI shipped in a live app", weight: "must" },
	{ id: "r3", label: "VoiceOver", detail: "Screens that work with VoiceOver", weight: "must" },
	{ id: "r4", label: "GraphQL", detail: "GraphQL on the client side", weight: "nice" },
	{ id: "r5", label: "Kotlin Multiplatform", detail: "Code shared with Android", weight: "off" },
	{ id: "r6", label: "Objective-C", detail: "Objective-C maintenance", weight: "nice", removed: true },
];
const evidence: EvidenceMap = {
	r1: { level: "clear", quote: "Six years of Swift" },
	r2: { level: "partial", quote: "Prototyped a SwiftUI screen" },
	r4: { level: "none", quote: "" },
	r5: { level: "clear", quote: "Shared code with KMP" },
	r6: { level: "clear", quote: "Kept the Objective-C core alive" },
};

describe("scoring", () => {
	it("keeps the landing demo's numbers (Grace 93 and Rayan 46 as posted)", () => {
		const posted = [3, 3, 3, 3, 1, 1];
		const score = (values: number[]) => weightedScore(values.map((value, k) => ({ weight: posted[k], value })));
		expect(score([1, 1, 1, 1, 1, 0])).toBe(93);
		expect(score([0, 0, 1, 0.5, 1, 1])).toBe(46);
	});

	it("is null when nothing counts", () => {
		expect(weightedScore([])).toBeNull();
		expect(scoreChecks([{ weight: "off", level: "clear" }])).toBeNull();
	});

	it("counts must 3, nice 1, off 0, clear 1, partial half, and not checked as none", () => {
		// r1 clear 3 + r2 partial 1.5 + r3 not checked 0 + r4 none 0, over 3 + 3 + 3 + 1; r5 is Off, r6 removed.
		expect(scoreEvidence(rubric, evidence)).toBe(Math.round((100 * 4.5) / 10));
	});

	it("lists checks in the job's order without removed requirements", () => {
		expect(toChecks(rubric, evidence)).toEqual([
			{ id: "r1", label: "Swift", weight: "must", level: "clear" },
			{ id: "r2", label: "SwiftUI", weight: "must", level: "partial" },
			{ id: "r3", label: "VoiceOver", weight: "must", level: null },
			{ id: "r4", label: "GraphQL", weight: "nice", level: "none" },
			{ id: "r5", label: "Kotlin Multiplatform", weight: "off", level: "clear" },
		]);
	});

	it("re-scores from the checks alone when a weight changes", () => {
		const checks = toChecks(rubric, evidence);
		const kmpOn: Check[] = checks.map((c) => (c.id === "r5" ? { ...c, weight: "must" } : c));
		expect(scoreChecks(kmpOn)).toBe(Math.round((100 * 7.5) / 13));
	});

	it("finds the requirements a CV hasn't been checked against, Off ones included", () => {
		const { r5: _, ...withoutKmp } = evidence;
		expect(uncheckedIds(rubric, withoutKmp)).toEqual(["r3", "r5"]);
	});

	it("names clear matches must-first and must-have gaps", () => {
		const checks: Check[] = [
			{ id: "r1", label: "GraphQL", weight: "nice", level: "clear" },
			{ id: "r2", label: "Swift", weight: "must", level: "clear" },
			{ id: "r3", label: "SwiftUI", weight: "must", level: "partial" },
			{ id: "r4", label: "VoiceOver", weight: "must", level: null },
			{ id: "r5", label: "Instruments", weight: "must", level: "none" },
			{ id: "r6", label: "Dynamic Type", weight: "must", level: "none" },
			{ id: "r7", label: "KMP", weight: "off", level: "clear" },
		];
		expect(matchLabels(checks)).toEqual(["Swift", "GraphQL"]);
		expect(gapLabels(checks)).toEqual(["VoiceOver", "Instruments"]);
	});

	it("ranks by score, then scored first, then uploaded first, then id, unscored last", () => {
		const row = (id: string, score: number | null, scoredAt: string | null, createdAt = "2026-10-24T10:00:00.000Z") => ({
			id,
			score,
			scoredAt,
			createdAt,
		});
		const rows = [
			row("e", null, null),
			row("d", 80, "2026-10-24T10:05:00.000Z"),
			row("c", 80, "2026-10-24T10:02:00.000Z", "2026-10-24T10:01:00.000Z"),
			row("b", 80, "2026-10-24T10:02:00.000Z"),
			row("a", 91, "2026-10-24T10:09:00.000Z"),
		];
		expect([...rows].sort(compareRanked).map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("never reuses a requirement id", () => {
		expect(nextRequirementId(rubric)).toBe("r7");
		expect(nextRequirementId([])).toBe("r1");
	});
});
