import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DECISION_LABEL, type BulkDecided, undoBatches, useBulkDecide, useBulkDelete } from "./candidates.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

afterEach(() => vi.unstubAllGlobals());

const row = (id: string, decision = "undecided") => ({ id, decision, status: "scored", name: id, fileName: `${id}.pdf` });
const listKey = ["candidates", "user_1", "job_1"];
const detailKey = [...listKey, "c1"];
const pageKey = ["all-candidates", "user_1", "/candidates"];
// Queries a bulk action makes out of date besides the candidates themselves.
const around = [["overview", "user_1", "attention"], ["jobs", "user_1", "list", "/jobs"], ["search", "user_1", "c"]];

function setup(answer: (path: string, body: { ids: string[] }) => Response | Promise<Response>) {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(new URL(url).pathname, JSON.parse(String(init?.body))));
	vi.stubGlobal("fetch", fetchMock);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(listKey, { candidates: [row("c1"), row("c2", "shortlisted")], cvCount: 2, cvLimit: 10 });
	client.setQueryData(detailKey, { ...row("c1"), rankedCount: 2, decidedAt: null, decidedBy: null, note: null });
	client.setQueryData(pageKey, { candidates: [row("c1"), row("c3")], total: 2, page: 1, pageSize: 50, counts: {} });
	for (const key of around) client.setQueryData(key, {});
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const decisions = () => ({
		list: client.getQueryData<{ candidates: { id: string; decision: string }[] }>(listKey)?.candidates.map((c) => [c.id, c.decision]),
		detail: client.getQueryData<{ decision: string; decidedBy: string | null }>(detailKey),
		page: client.getQueryData<{ candidates: { id: string; decision: string }[] }>(pageKey)?.candidates.map((c) => [c.id, c.decision]),
	});
	return { client, fetchMock, wrapper, decisions };
}

describe("DECISION_LABEL", () => {
	it("calls a rejected CV not a fit", () => {
		expect(DECISION_LABEL.rejected).toBe("Not a fit");
	});
});

describe("undoBatches", () => {
	it("groups the changed CVs by the decision they had", () => {
		const updated: BulkDecided[] = [
			{ id: "a", jobId: "j1", decision: "shortlisted", previous: "undecided" },
			{ id: "b", jobId: "j2", decision: "shortlisted", previous: "rejected" },
			{ id: "c", jobId: "j1", decision: "shortlisted", previous: "undecided" },
		];
		expect(undoBatches(updated)).toEqual([
			{ ids: ["a", "c"], decision: "undecided" },
			{ ids: ["b"], decision: "rejected" },
		]);
		expect(undoBatches([])).toEqual([]);
	});
});

describe("useBulkDecide", () => {
	it("shows the decision in every cached list and candidate at once, then marks what counts decisions out of date", async () => {
		let release = () => {};
		const { client, fetchMock, wrapper, decisions } = setup(
			(_path, { ids }) =>
				new Promise((resolve) => {
					release = () =>
						resolve(Response.json({ updated: ids.map((id) => ({ id, jobId: "job_1", decision: "shortlisted", previous: "undecided" })) }));
				}),
		);
		const { result } = renderHook(() => useBulkDecide(), { wrapper });
		act(() => result.current.mutate({ ids: ["c1", "c3"], decision: "shortlisted" }));

		await waitFor(() => expect(decisions().list).toEqual([["c1", "shortlisted"], ["c2", "shortlisted"]]));
		expect(decisions().detail).toMatchObject({ decision: "shortlisted", decidedBy: "user_1" });
		expect(decisions().page).toEqual([["c1", "shortlisted"], ["c3", "shortlisted"]]);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/\/candidates\/decisions$/);
		expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ ids: ["c1", "c3"], decision: "shortlisted" }) });

		await act(async () => release());
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toHaveLength(2);
		for (const key of [listKey, detailKey, pageKey, ...around]) expect(client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
	});

	it("puts every cached list and candidate back when the API refuses", async () => {
		const { wrapper, decisions } = setup(() => Response.json({ error: { message: "No" } }, { status: 500 }));
		const { result } = renderHook(() => useBulkDecide(), { wrapper });
		act(() => result.current.mutate({ ids: ["c1", "c2", "c3"], decision: "rejected" }));

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(decisions()).toEqual({
			list: [["c1", "undecided"], ["c2", "shortlisted"]],
			detail: expect.objectContaining({ decision: "undecided", decidedBy: null }),
			page: [["c1", "undecided"], ["c3", "undecided"]],
		});
	});
});

describe("useBulkDelete", () => {
	it("takes deleted CVs out of the cached lists and marks their own query stale without dropping it", async () => {
		const { client, fetchMock, wrapper } = setup((_path, { ids }) =>
			Response.json({ deleted: ids.filter((id) => id !== "c3").map((id) => ({ id, jobId: "job_1" })) }),
		);
		const { result } = renderHook(() => useBulkDelete(), { wrapper });
		act(() => result.current.mutate(["c1", "c3"]));

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(fetchMock.mock.calls[0][0]).toMatch(/\/candidates\/delete$/);
		expect(client.getQueryData<{ candidates: { id: string }[] }>(listKey)?.candidates.map((c) => c.id)).toEqual(["c2"]);
		expect(client.getQueryData<{ candidates: { id: string }[] }>(pageKey)?.candidates.map((c) => c.id)).toEqual(["c3"]);
		expect(client.getQueryData(detailKey)).toBeDefined();
		expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
		for (const key of [listKey, pageKey, ...around]) expect(client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
	});
});
