import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCvPreview } from "./use-cv-preview.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

let made = 0;
const createObjectURL = vi.fn((_blob: Blob) => `blob:cv-${++made}`);
const revokeObjectURL = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;
const cvRequests = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
	made = 0;
	createObjectURL.mockClear();
	revokeObjectURL.mockClear();
	// jsdom has neither of these.
	Object.assign(URL, { createObjectURL, revokeObjectURL });
	fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
		// The API may not say it is a PDF; the preview must still be one, or the browser won't show it.
		new Response("%PDF-1.4 fake", { headers: { "Content-Type": "application/octet-stream" } }),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	Reflect.deleteProperty(URL, "createObjectURL");
	Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("the CV preview", () => {
	it("fetches nothing until it is wanted, then the PDF with the token, as a temporary URL", async () => {
		const { result, rerender } = renderHook(({ enabled }) => useCvPreview("job_1", "cand_grace", enabled), {
			initialProps: { enabled: false },
		});
		expect(result.current.preview).toEqual({ state: "idle" });
		expect(fetchMock).not.toHaveBeenCalled();

		rerender({ enabled: true });
		expect(result.current.preview).toEqual({ state: "loading" });
		await waitFor(() => expect(result.current.preview).toEqual({ state: "ready", url: "blob:cv-1" }));
		expect(cvRequests()).toEqual(["http://localhost:8787/jobs/job_1/candidates/cand_grace/cv"]);
		expect(fetchMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }),
		);
		const blob = createObjectURL.mock.calls[0][0];
		expect(blob.type).toBe("application/pdf");
		expect(await blob.text()).toBe("%PDF-1.4 fake");
		expect(revokeObjectURL).not.toHaveBeenCalled();
	});

	it("revokes the URL when the candidate changes, and never shows the last one's file", async () => {
		const { result, rerender } = renderHook(({ id }) => useCvPreview("job_1", id, true), {
			initialProps: { id: "cand_grace" },
		});
		await waitFor(() => expect(result.current.preview).toEqual({ state: "ready", url: "blob:cv-1" }));

		rerender({ id: "cand_kenji" });
		expect(result.current.preview).toEqual({ state: "loading" });
		expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cv-1");
		await waitFor(() => expect(result.current.preview).toEqual({ state: "ready", url: "blob:cv-2" }));
		expect(cvRequests().at(-1)).toBe("http://localhost:8787/jobs/job_1/candidates/cand_kenji/cv");
	});

	it("revokes the URL when the page goes", async () => {
		const { result, unmount } = renderHook(() => useCvPreview("job_1", "cand_grace", true));
		await waitFor(() => expect(result.current.preview.state).toBe("ready"));

		unmount();
		expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cv-1");
	});

	it("cancels a fetch still on its way, and makes no URL for it", async () => {
		let signal: AbortSignal | undefined;
		fetchMock.mockImplementation(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					signal = init?.signal ?? undefined;
					signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
				}),
		);
		const { unmount } = renderHook(() => useCvPreview("job_1", "cand_grace", true));
		await waitFor(() => expect(signal).toBeDefined());

		unmount();
		expect(signal?.aborted).toBe(true);
		await act(async () => {});
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(revokeObjectURL).not.toHaveBeenCalled();
	});

	it("says when the file can't be fetched, and tries again", async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ error: { code: "file_missing", message: "The CV file is missing" } }, { status: 404 }),
		);
		const { result } = renderHook(() => useCvPreview("job_1", "cand_grace", true));
		await waitFor(() => expect(result.current.preview).toEqual({ state: "failed" }));
		expect(createObjectURL).not.toHaveBeenCalled();

		act(() => result.current.retry());
		expect(result.current.preview).toEqual({ state: "loading" });
		await waitFor(() => expect(result.current.preview).toEqual({ state: "ready", url: "blob:cv-1" }));
		expect(cvRequests()).toHaveLength(2);
	});
});
