import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "./routeTree.gen.ts";

// Clerk is replaced by a session we control; the API by an in-memory fake of /me and /orgs.
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@clerk/react", () => ({
	useAuth: () => ({
		isLoaded: true,
		isSignedIn: session.signedIn,
		userId: session.signedIn ? "user_1" : null,
		getToken: async () => (session.signedIn ? "session-token" : null),
	}),
	RedirectToSignIn: () => <p>Redirecting to sign in</p>,
	UserButton: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

type Org = { id: string; name: string; role: "admin" };
let org: Org | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	session.signedIn = true;
	org = null;
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		if (path === "/me") return Response.json({ userId: "user_1", org });
		if (path === "/orgs" && init?.method === "POST") {
			const { name } = JSON.parse(String(init.body)) as { name: string };
			org = { id: "org_1", name, role: "admin" };
			return Response.json({ org }, { status: 201 });
		}
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	// The router restores scroll on navigation; jsdom doesn't implement it.
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderAt(path: string) {
	const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

describe("signing in for the first time", () => {
	it("sends a recruiter without a company from the dashboard to onboarding, then back", async () => {
		const router = renderAt("/dashboard");

		const input = await screen.findByLabelText("Company name");
		expect(router.state.location.pathname).toBe("/onboarding");

		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"✕ Enter a company name between 2 and 80 characters",
		);
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/orgs"), expect.anything());

		fireEvent.change(input, { target: { value: "  Sprite   Labs " } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));

		expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
		expect(screen.getAllByText("Sprite Labs").length).toBeGreaterThan(0);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/orgs",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ name: "Sprite Labs" }),
				headers: expect.objectContaining({ Authorization: "Bearer session-token" }),
			}),
		);
	});
});

describe("returning recruiters", () => {
	it("skip onboarding and land on their dashboard", async () => {
		org = { id: "org_1", name: "Acme Hiring", role: "admin" };
		const router = renderAt("/onboarding");

		expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
	});
});

describe("signed-out visitors", () => {
	it("are sent to sign in from the dashboard and onboarding", async () => {
		session.signedIn = false;

		renderAt("/dashboard");
		expect(await screen.findByText("Redirecting to sign in")).toBeTruthy();
		cleanup();

		renderAt("/onboarding");
		expect(await screen.findByText("Redirecting to sign in")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
