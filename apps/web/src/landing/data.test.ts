import { describe, expect, it } from "vitest";
import {
	CANDIDATES,
	PRESETS,
	formatCount,
	matchingPreset,
	planForPile,
	rankCandidates,
	scoreCandidates,
} from "./data.ts";

const names = (order: number[]) => order.map((i) => CANDIDATES[i].name);

describe("scoreCandidates", () => {
	it("gives the scores printed on the page for the job as posted", () => {
		expect(scoreCandidates(PRESETS.posted.weights)).toEqual([93, 71, 54, 50, 46, 25, 21]);
	});

	it("returns no scores when every requirement is off", () => {
		expect(scoreCandidates([0, 0, 0, 0, 0, 0])).toEqual(Array(7).fill(null));
	});
});

describe("rankCandidates", () => {
	it("puts Grace first for the job as posted", () => {
		expect(names(rankCandidates(scoreCandidates(PRESETS.posted.weights)))[0]).toBe("Grace Turner");
	});

	it("puts Rayan first when the job leans Android", () => {
		expect(names(rankCandidates(scoreCandidates(PRESETS.android.weights)))[0]).toBe("Rayan Al-Farsi");
	});

	it("breaks ties by who applied first", () => {
		// With only Accessibility on, Grace, Amelia and Sophia all score 100; Sophia applied first.
		const order = names(rankCandidates(scoreCandidates([0, 0, 0, 3, 0, 0])));
		expect(order.slice(0, 3)).toEqual(["Sophia Carter", "Amelia Nguyen", "Grace Turner"]);
	});
});

describe("matchingPreset", () => {
	it("recognises a preset and returns null for a custom mix", () => {
		expect(matchingPreset([3, 3, 3, 3, 1, 1])).toBe("posted");
		expect(matchingPreset([3, 3, 3, 3, 1, 0])).toBeNull();
	});
});

describe("planForPile", () => {
	it("fits the pile to the cheapest plan that reads it", () => {
		expect([5, 10, 25, 50, 100, 250, 1000].map(planForPile)).toEqual([
			"free",
			"free",
			"pro",
			"pro",
			"pro",
			"max",
			"max",
		]);
	});

	it("formats a thousand with a separator", () => {
		expect(formatCount(1000)).toBe("1,000");
		expect(formatCount(50)).toBe("50");
	});
});
