import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSequence } from "./use-sequence.ts";

const STEPS = [100, 300] as const;

function stubReducedMotion(matches: boolean) {
	vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query }));
}

describe("useSequence", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("moves to the next step at each delay, then rests on the last one", () => {
		vi.useFakeTimers();
		stubReducedMotion(false);
		const { result } = renderHook(() => useSequence(STEPS));
		expect(result.current).toBe(0);

		act(() => vi.advanceTimersByTime(100));
		expect(result.current).toBe(1);
		act(() => vi.advanceTimersByTime(200));
		expect(result.current).toBe(2);
		act(() => vi.advanceTimersByTime(5000));
		expect(result.current).toBe(2);
	});

	it("starts on the last step with reduced motion, so the scene is complete at rest", () => {
		vi.useFakeTimers();
		stubReducedMotion(true);
		const { result } = renderHook(() => useSequence(STEPS));
		expect(result.current).toBe(2);
		act(() => vi.advanceTimersByTime(5000));
		expect(result.current).toBe(2);
	});
});
