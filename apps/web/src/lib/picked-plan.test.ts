import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberPickedPlan, takePickedPlan } from "./picked-plan.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

describe("the picked plan", () => {
	it("is kept until it is read, and read only once", () => {
		rememberPickedPlan("max");
		expect(takePickedPlan()).toBe("max");
		expect(takePickedPlan()).toBeUndefined();
	});

	it("ignores anything that is not a paid plan", () => {
		sessionStorage.setItem("lucidhire:picked-plan", "free");
		expect(takePickedPlan()).toBeUndefined();
		sessionStorage.setItem("lucidhire:picked-plan", "<script>");
		expect(takePickedPlan()).toBeUndefined();
	});

	it("does nothing, without throwing, when storage is blocked", () => {
		vi.stubGlobal("sessionStorage", {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		});
		expect(() => rememberPickedPlan("pro")).not.toThrow();
		expect(takePickedPlan()).toBeUndefined();
	});
});
