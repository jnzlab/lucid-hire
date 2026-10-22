import { describe, expect, it } from "vitest";
import { PLANS, planFeatures, planForCvs, planRank } from "./index.ts";

describe("plans", () => {
	it("holds the numbers the landing page promises", () => {
		expect(PLANS.free).toMatchObject({ priceUsd: 0, cvsPerJob: 10, jobsPerMonth: 10, aiPerHour: 30 });
		expect(PLANS.pro).toMatchObject({ priceUsd: 10, cvsPerJob: 100, jobsPerMonth: 20, aiPerHour: 150 });
		expect(PLANS.max).toMatchObject({ priceUsd: 30, cvsPerJob: 1000, jobsPerMonth: null, aiPerHour: 600 });
	});

	it("fits a pile to the cheapest plan that reads it", () => {
		expect([5, 10, 25, 100, 250, 1000].map(planForCvs)).toEqual(["free", "free", "pro", "pro", "max", "max"]);
	});

	it("lists features for a card", () => {
		expect(planFeatures(PLANS.max)).toEqual([
			"1,000 CVs per job",
			"Unlimited jobs",
			"600 AI requests an hour",
			"First in the reading queue",
		]);
	});

	it("ranks plans from smallest to biggest", () => {
		expect(planRank("free")).toBeLessThan(planRank("pro"));
		expect(planRank("pro")).toBeLessThan(planRank("max"));
	});
});
