import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router.ts";

const clerk = vi.hoisted(() => ({ signedIn: true, signOut: vi.fn() }));

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: clerk.signedIn, userId: null, getToken: async () => null }),
	useClerk: () => ({ signOut: clerk.signOut }),
	Show: () => null,
}));

beforeEach(() => {
	clerk.signedIn = true;
	clerk.signOut.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderSignOut() {
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/sign-out"] }));
	const client = new QueryClient();
	client.setQueryData(["me", "user_1"], { org: "kept until sign-out" });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return { router, client };
}

describe("sign-out page", () => {
	it("signs a signed-in user out, stays on the page and offers the way back", async () => {
		const { router, client } = renderSignOut();

		expect(await screen.findByText("You're signed out.")).toBeTruthy();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("You're signed out.");
		expect(clerk.signOut).toHaveBeenCalledOnce();
		// An empty callback keeps Clerk from redirecting to the home page.
		expect(clerk.signOut).toHaveBeenCalledWith(expect.any(Function));
		expect(client.getQueryData(["me", "user_1"])).toBeUndefined();
		expect(router.state.location.pathname).toBe("/sign-out");
		expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe("/sign-in");
		expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
		expect(document.title).toBe("Sign out · LucidHire");
	});

	it("says so when there was no session, without calling Clerk", async () => {
		clerk.signedIn = false;
		renderSignOut();

		expect(await screen.findByText(/You're already signed out/)).toBeTruthy();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("You're already signed out.");
		expect(clerk.signOut).not.toHaveBeenCalled();
	});

	it("shows the error and retries when signing out throws", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		clerk.signOut.mockRejectedValueOnce(new Error("Network down"));
		renderSignOut();

		expect((await screen.findByRole("alert")).textContent).toBe("✕ Network down");
		expect(screen.getByRole("heading", { level: 2, name: "We couldn't sign you out" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		expect(await screen.findByText("You're signed out.")).toBeTruthy();
		expect(clerk.signOut).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
