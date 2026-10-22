import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiStatus } from "./api-status.tsx";

function renderStatus() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ApiStatus />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ApiStatus", () => {
	it("says the API is online when /health answers ok", async () => {
		const fetchMock = vi.fn(async () => Response.json({ ok: true, service: "lucidhire-api" }));
		vi.stubGlobal("fetch", fetchMock);

		renderStatus();

		expect(await screen.findByText("API online · lucidhire-api")).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/health", expect.anything());
	});

	it("says the API is unreachable when /health fails", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "down" } }, { status: 503 })));

		renderStatus();

		expect(await screen.findByText("API unreachable", {}, { timeout: 4000 })).toBeTruthy();
	});
});
