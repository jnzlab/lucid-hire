import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router.ts";

const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@clerk/react", () => ({
	useAuth: () => ({
		isLoaded: true,
		isSignedIn: session.signedIn,
		userId: session.signedIn ? "user_9" : null,
		getToken: async () => (session.signedIn ? "session-token" : null),
	}),
	// The dashboard's account menu reads the name and email; without a user it shows "Your account".
	useUser: () => ({ isLoaded: true, user: null }),
	RedirectToSignIn: () => <p>Redirecting to sign in</p>,
	UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
	UserProfile: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

let org: { id: string; name: string; role: "admin" | "member" } | null;
let inviteReply: () => Response;
let acceptReply: () => Response;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

beforeEach(() => {
	session.signedIn = true;
	org = null;
	inviteReply = () => Response.json({ company: { name: "Sprite Labs" } });
	acceptReply = () => {
		org = { id: "org_1", name: "Sprite Labs", role: "member" };
		return Response.json({ org });
	};
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		if (path === "/me") return Response.json({ userId: "user_9", org });
		if (path === "/invites/tok_abc") return inviteReply();
		if (path === "/invites/tok_abc/accept" && init?.method === "POST") return acceptReply();
		if (path === "/jobs") return Response.json({ jobs: [], total: 0, page: 1, pageSize: 20 });
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderAt(path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

describe("the invite page", () => {
	it("offers to join the company and sends the new member to the dashboard", async () => {
		const router = renderAt("/invite/tok_abc");
		expect((await screen.findByRole("heading", { level: 1, name: /Join Sprite Labs/ }, { timeout: 5000 })).textContent).toBe("Join Sprite Labs.");

		fireEvent.click(screen.getByRole("button", { name: /^Join Sprite Labs/ }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/invites/tok_abc/accept",
			expect.objectContaining({ method: "POST" }),
		);
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
	});

	it("sends a signed-out visitor to sign in first", async () => {
		session.signedIn = false;
		renderAt("/invite/tok_abc");
		expect(await screen.findByText("Redirecting to sign in", {}, { timeout: 5000 })).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("explains a link that no longer works", async () => {
		inviteReply = () =>
			Response.json({ error: { code: "invite_invalid", message: "This invite link has expired, been used or been withdrawn. Ask for a new one." } }, { status: 404 });
		renderAt("/invite/tok_abc");
		expect(await screen.findByRole("heading", { name: /This invite link doesn't work/ }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByText(/Ask for a new one/)).toBeTruthy();
		expect(screen.getByRole("link", { name: /Go to your dashboard/ })).toBeTruthy();
	});

	it("tells someone who already has a company that the invite can't be used", async () => {
		org = { id: "org_9", name: "Acme", role: "admin" };
		renderAt("/invite/tok_abc");
		expect(await screen.findByRole("heading", { name: /You already belong to a company/ }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByText(/You're part of Acme/)).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/invites/"), expect.anything());
	});

	it("shows the error when joining fails", async () => {
		acceptReply = () => Response.json({ error: { code: "has_company", message: "You already belong to a company" } }, { status: 409 });
		renderAt("/invite/tok_abc");
		fireEvent.click(await screen.findByRole("button", { name: /^Join Sprite Labs/ }, { timeout: 5000 }));
		expect((await screen.findByRole("alert")).textContent).toContain("You already belong to a company");
	});
});
