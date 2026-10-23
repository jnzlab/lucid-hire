import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meQueryKey } from "./me.ts";
import { cleanOrgName, useRenameOrg } from "./org.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("cleanOrgName", () => {
	it("tidies the name like the API, and refuses one too short or too long", () => {
		expect(cleanOrgName("  Sprite   Labs ")).toBe("Sprite Labs");
		expect(cleanOrgName(" A ")).toBeNull();
		expect(cleanOrgName("x".repeat(81))).toBeNull();
		expect(cleanOrgName("x".repeat(80))).toBe("x".repeat(80));
	});
});

describe("useRenameOrg", () => {
	it("sends the name and puts the renamed company into the cached account", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
			Response.json({ org: { id: "org_1", name: JSON.parse(String(init?.body)).name, role: "admin" } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const client = new QueryClient();
		client.setQueryData(meQueryKey("user_1"), { userId: "user_1", org: { id: "org_1", name: "Old Co", role: "admin" } });
		const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

		const { result } = renderHook(() => useRenameOrg(), { wrapper });
		act(() => result.current.mutate("New Co"));

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/\/orgs\/current$/);
		expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "New Co" }) });
		expect(client.getQueryData(meQueryKey("user_1"))).toEqual({ userId: "user_1", org: { id: "org_1", name: "New Co", role: "admin" } });
	});
});
