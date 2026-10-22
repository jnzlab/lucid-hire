import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	RedirectToSignIn: () => null,
	UserButton: () => <button type="button">Account</button>,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

const job = (id: string, title: string, status: string) => ({
	id,
	title,
	status,
	cvCount: 0,
	createdAt: "2026-10-22T12:00:00Z",
	updatedAt: "2026-10-22T12:00:00Z",
});

let role: "admin" | "member";
let jobs: ReturnType<typeof job>[];

beforeEach(() => {
	role = "admin";
	jobs = [job("job_3", "Draft role", "draft"), job("job_2", "Open role", "open"), job("job_1", "Older open", "open")];
	localStorage.clear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url).pathname;
			if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } });
			if (path === "/jobs") return Response.json({ jobs });
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		}),
	);
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

describe("sidebar", () => {
	it("shows the company, the pages, the shortcuts and the role", { timeout: 15_000 }, async () => {
		renderAt("/dashboard");
		const nav = await screen.findByRole("navigation", { name: "Main" }, { timeout: 4000 });

		expect(within(nav).getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("page");
		expect(within(nav).getByRole("link", { name: "Post a job" }).getAttribute("href")).toBe("/dashboard/jobs/new");
		expect(screen.getAllByText("Sprite Labs").length).toBeGreaterThan(0);
		expect(screen.getByText("Your role: Admin")).toBeTruthy();
		expect(screen.getByRole("link", { name: "LucidHire dashboard" })).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Account" }).length).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
	});

	it("says Member for members, and marks Jobs as the section while on a job's page", async () => {
		role = "member";
		renderAt("/dashboard/jobs/job_2");
		const nav = await screen.findByRole("navigation", { name: "Main" });
		expect(screen.getByText("Your role: Member")).toBeTruthy();
		expect(within(nav).getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("true");
	});

	it("sends Upload CVs to the newest open job's upload area", async () => {
		renderAt("/dashboard");
		const link = await within(await screen.findByRole("navigation", { name: "Main" })).findByRole("link", { name: "Upload CVs" });
		await waitFor(() => expect(link.getAttribute("href")).toBe("/dashboard/jobs/job_2#upload"));
	});

	it("falls back to the newest job when none is open, and to the new-job page without jobs", async () => {
		jobs = [job("job_3", "Draft role", "draft"), job("job_1", "Closed", "closed")];
		renderAt("/dashboard");
		const nav = await screen.findByRole("navigation", { name: "Main" });
		await waitFor(() =>
			expect(within(nav).getByRole("link", { name: "Upload CVs" }).getAttribute("href")).toBe("/dashboard/jobs/job_3#upload"),
		);
		cleanup();

		jobs = [];
		renderAt("/dashboard");
		const empty = await screen.findByRole("navigation", { name: "Main" });
		await screen.findByRole("heading", { name: "No jobs yet" });
		expect(within(empty).getByRole("link", { name: "Upload CVs" }).getAttribute("href")).toBe("/dashboard/jobs/new");
	});
});

describe("collapsing the sidebar", () => {
	it("collapses with the button, keeps every link named, and remembers the choice", async () => {
		renderAt("/dashboard");
		const toggle = await screen.findByRole("button", { name: "Collapse sidebar" });
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(toggle);
		expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
		expect(localStorage.getItem("lucidhire.sidebar")).toBe("collapsed");
		expect(screen.queryByText("Your role: Admin")?.className ?? "sr-only").toContain("sr-only");
		expect(screen.getByRole("link", { name: "Jobs" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Post a job" })).toBeTruthy();
	});

	it("starts collapsed when it was left collapsed", async () => {
		localStorage.setItem("lucidhire.sidebar", "collapsed");
		renderAt("/dashboard");
		expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeTruthy();
	});

	it("toggles with Ctrl+B and Cmd+B, but not while typing in a field", async () => {
		renderAt("/dashboard/jobs/new");
		await screen.findByRole("button", { name: "Collapse sidebar" });

		fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
		expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
		fireEvent.keyDown(document.body, { key: "b", metaKey: true });
		expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();

		fireEvent.keyDown(await screen.findByLabelText("Job title"), { key: "b", ctrlKey: true });
		expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
	});

	it("still works when storage is blocked", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		renderAt("/dashboard");
		fireEvent.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
		expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
		vi.restoreAllMocks();
	});
});

describe("mobile menu", () => {
	it("shows the breadcrumb, opens a sheet that traps focus, and closes on Escape with focus back", async () => {
		renderAt("/dashboard/jobs/new");
		const breadcrumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
		expect(within(breadcrumb).getByRole("link", { name: "Dashboard" })).toBeTruthy();
		expect(within(breadcrumb).getByText("Post a job").getAttribute("aria-current")).toBe("page");

		const open = screen.getByRole("button", { name: "Open menu" });
		open.focus();
		fireEvent.click(open);
		const sheet = await screen.findByRole("dialog", { name: "Menu" });
		expect(sheet.contains(document.activeElement)).toBe(true);

		const close = within(sheet).getByRole("button", { name: "Close menu" });
		const links = within(sheet).getAllByRole("link");
		links[links.length - 1].focus();
		fireEvent.keyDown(document, { key: "Tab" });
		expect(document.activeElement).toBe(within(sheet).getAllByRole("link")[0]);
		fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(links[links.length - 1]);
		expect(close).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(open);
	});

	it("closes after choosing a page", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.click(await screen.findByRole("button", { name: "Open menu" }));
		const sheet = await screen.findByRole("dialog", { name: "Menu" });
		fireEvent.click(within(sheet).getByRole("link", { name: "Jobs" }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
