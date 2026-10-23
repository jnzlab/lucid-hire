import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchText, useSearch } from "./search.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("searchText", () => {
	it("trims, collapses inner whitespace and caps the text at 100 characters", () => {
		expect(searchText("  ada   lovelace ")).toBe("ada lovelace");
		expect(searchText("   ")).toBe("");
		expect(searchText(`${"a".repeat(99)}  b`)).toBe(`${"a".repeat(99)}`);
		expect(searchText("x".repeat(120))).toHaveLength(100);
	});
});

describe("useSearch", () => {
	const found = (q: string) => ({ jobs: [], candidates: [{ id: `c_${q}`, jobId: "j", jobTitle: "Job", name: q, fileName: "cv.pdf", headline: null, score: 80, decision: "undecided" }] });

	function setup() {
		const requests: Array<{ q: string; signal: AbortSignal; answer: () => void }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(url: string, init: RequestInit) =>
					new Promise<Response>((resolve, reject) => {
						const q = new URL(url).searchParams.get("q") ?? "";
						const signal = init.signal as AbortSignal;
						signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
						requests.push({ q, signal, answer: () => resolve(Response.json(found(q))) });
					}),
			),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
		const hook = renderHook(({ q }) => useSearch(q, { debounceMs: 20 }), { wrapper, initialProps: { q: "" } });
		return { requests, ...hook };
	}

	it("asks nothing for blank text", async () => {
		const { requests, result, rerender } = setup();
		rerender({ q: "   " });
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(requests).toHaveLength(0);
		expect(result.current).toMatchObject({ results: undefined, isSearching: false, searchedFor: "" });
	});

	it("waits for typing to pause, cancels the search before and keeps its results on screen meanwhile", async () => {
		const { requests, result, rerender } = setup();
		rerender({ q: "a" });
		rerender({ q: "ad" });
		rerender({ q: " ada " });
		expect(result.current.isSearching).toBe(true);
		await waitFor(() => expect(requests).toHaveLength(1));
		// Only the text typing paused on went out.
		expect(requests[0].q).toBe("ada");
		requests[0].answer();
		await waitFor(() => expect(result.current.isSearching).toBe(false));
		expect(result.current.searchedFor).toBe("ada");
		expect(result.current.results?.candidates[0].id).toBe("c_ada");

		rerender({ q: "adx" });
		await waitFor(() => expect(requests).toHaveLength(2));
		rerender({ q: "adz" });
		await waitFor(() => expect(requests).toHaveLength(3));
		expect(requests[1].signal.aborted).toBe(true);
		// The last results stay, labelled with what they were for, while the new search runs.
		expect(result.current).toMatchObject({ isSearching: true, searchedFor: "ada" });
		expect(result.current.results?.candidates[0].id).toBe("c_ada");

		requests[2].answer();
		await waitFor(() => expect(result.current.searchedFor).toBe("adz"));
		expect(result.current.isSearching).toBe(false);
	});
});
