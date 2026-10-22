import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LandingFooter } from "./footer.tsx";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null, getToken: async () => null }),
	Show: () => null,
	SignInButton: () => null,
	SignUpButton: () => null,
	UserButton: () => null,
}));

afterEach(cleanup);

it("links the legal pages and support from the landing footer", async () => {
	vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
	const router = createRouter({
		routeTree: createRootRoute({ component: LandingFooter }),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	const footer = within(await screen.findByRole("contentinfo"));
	const nav = footer.getByRole("navigation", { name: "Footer" });

	expect(within(nav).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
	expect(within(nav).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
	expect(within(nav).getByRole("link", { name: "Support" }).getAttribute("href")).toBe("mailto:support@lucidhire.io");
});
