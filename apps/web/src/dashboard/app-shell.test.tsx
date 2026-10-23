import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setThemePreference } from "../lib/theme.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	useUser: () => ({
		isLoaded: true,
		user: { fullName: "Grace Turner", primaryEmailAddress: { emailAddress: "grace@sprite.test" }, hasImage: false },
	}),
	RedirectToSignIn: () => null,
	UserButton: Object.assign(() => <button type="button">Account</button>, { MenuItems: () => null, Link: () => null }),
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

const job = (id: string, title: string, status: string, counts: { toReview?: number; reading?: number } = {}) => ({
	id,
	slug: id,
	title,
	status,
	cvCount: 0,
	hasCover: false,
	scoredCount: 0,
	toReviewCount: counts.toReview ?? 0,
	shortlistedCount: 0,
	rejectedCount: 0,
	readingCount: counts.reading ?? 0,
	failedCount: 0,
	topScore: null,
	topCandidate: null,
	lastCvAt: null,
	createdAt: "2026-10-22T12:00:00Z",
	updatedAt: "2026-10-22T12:00:00Z",
});

let role: "admin" | "member";
let jobs: ReturnType<typeof job>[];
let billing: "pro" | "free" | "fail";
let toReview: number;

beforeEach(() => {
	role = "admin";
	billing = "pro";
	toReview = 7;
	jobs = [
		job("job_3", "Draft role", "draft"),
		job("job_2", "Open role", "open", { toReview: 5, reading: 2 }),
		job("job_1", "Older open", "open", { toReview: 2 }),
	];
	localStorage.clear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const { pathname: path, searchParams } = new URL(url);
			if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } });
			if (path === "/billing") {
				if (billing === "fail") return Response.json({ error: { message: "down" } }, { status: 500 });
				return Response.json({
					plan: billing,
					effectivePlan: billing,
					status: "active",
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					usage: { jobsThisMonth: 2, jobsLimit: billing === "free" ? 3 : null, busiestJob: null, cvLimit: 100, aiThisHour: 0, aiLimit: 50 },
					isAdmin: role === "admin",
				});
			}
			if (path === "/jobs") {
				const status = searchParams.get("status");
				const shown = jobs.filter((j) => !status || j.status === status);
				const count = (s: string) => jobs.filter((j) => j.status === s).length;
				return Response.json({
					jobs: shown,
					total: shown.length,
					page: 1,
					pageSize: 20,
					counts: { all: jobs.length, open: count("open"), draft: count("draft"), closed: count("closed") },
				});
			}
			if (path === "/overview/attention") {
				return Response.json({
					totals: { toReview, reading: 0, failed: 0, openJobs: 2, jobsToReview: 2 },
					waiting: [],
					failed: [],
					emptyOpenJobs: [],
					drafts: [],
					bestNew: [],
				});
			}
			if (path === "/search") {
				return Response.json({
					jobs: [{ id: "job_2", title: "Open role", status: "open", cvCount: 4 }],
					candidates: [
						{
							id: "c_1",
							jobId: "job_2",
							jobTitle: "Open role",
							name: "Grace Hopper",
							fileName: "grace.pdf",
							headline: null,
							score: 91,
							decision: "shortlisted",
						},
					],
				});
			}
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		}),
	);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	setThemePreference("system");
	localStorage.clear();
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

// Phone width: the shell reads the 768px breakpoint through matchMedia.
function stubPhone() {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: query.includes("max-width") || query === "(pointer: coarse)",
		media: query,
		addEventListener() {},
		removeEventListener() {},
	}));
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

describe("sidebar", () => {
	it("shows the company, the sections, Post a job and the account", { timeout: 15_000 }, async () => {
		renderAt("/dashboard");
		const nav = await screen.findByRole("navigation", { name: "Main" }, { timeout: 4000 });
		const sidebar = screen.getByRole("complementary", { name: "Sidebar" });

		expect(within(nav).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
		expect(within(nav).getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBeNull();
		expect(within(nav).getByRole("link", { name: /^Candidates/ }).getAttribute("href")).toBe("/dashboard/candidates");
		expect(within(sidebar).getByRole("link", { name: "Post a job" }).getAttribute("href")).toBe("/dashboard/jobs/new");
		expect(within(sidebar).getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/dashboard/settings");
		expect(within(sidebar).getByText("Sprite Labs")).toBeTruthy();
		expect(screen.getByRole("link", { name: "LucidHire dashboard" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Account: Grace Turner, Admin" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
	});

	it("says Member for members, and marks Jobs as the section while on a job's page", async () => {
		role = "member";
		renderAt("/dashboard/jobs/job_2");
		const nav = await screen.findByRole("navigation", { name: "Main" });
		expect(screen.getByRole("button", { name: "Account: Grace Turner, Member" })).toBeTruthy();
		expect(within(nav).getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("true");
	});

	it("counts what's waiting on Candidates, and lists the open jobs with theirs", async () => {
		renderAt("/dashboard/jobs/job_2");
		const nav = await screen.findByRole("navigation", { name: "Main" });
		await waitFor(() => expect(within(nav).getByRole("link", { name: /^Candidates/ }).textContent).toContain("7 to review"));

		const openJobs = within(within(nav).getByRole("region", { name: "Open jobs" }));
		const open = await openJobs.findByRole("link", { name: /^Open role/ });
		expect(open.getAttribute("href")).toBe("/dashboard/jobs/job_2");
		expect(open.getAttribute("aria-current")).toBe("page");
		expect(open.textContent).toContain("reading 2 CVs");
		expect(open.textContent).toContain("5 to review");
		expect(openJobs.getByRole("link", { name: /^Older open/ }).getAttribute("aria-current")).toBeNull();
		expect(openJobs.queryByRole("link", { name: /Draft role/ })).toBeNull();
	});

	it("offers Post a job when nothing is open", async () => {
		jobs = [job("job_3", "Draft role", "draft")];
		renderAt("/dashboard");
		const openJobs = within(await screen.findByRole("region", { name: "Open jobs" }));
		expect(await openJobs.findByText(/No open jobs/)).toBeTruthy();
		expect(openJobs.getByRole("link", { name: "Post a job" }).getAttribute("href")).toBe("/dashboard/jobs/new");
	});
});

describe("plan badge and allowance", () => {
	it("shows the plan beside the company and links to Plan & billing", async () => {
		renderAt("/dashboard");
		const badge = await screen.findByRole("link", { name: "Pro plan, see plans" });
		expect(badge.textContent).toBe("Pro");
		expect(badge.getAttribute("href")).toBe("/dashboard/settings/billing");
		expect(screen.queryByRole("meter")).toBeNull();
	});

	it("shows nothing when the plan can't be read, and the shell still works", async () => {
		billing = "fail";
		renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(screen.queryByRole("link", { name: /plan, see plans/ })).toBeNull();
	});

	it("shows the month's jobs and Upgrade on Free", async () => {
		billing = "free";
		renderAt("/dashboard");
		const meter = await screen.findByRole("meter", { name: "Jobs this month" });
		expect(meter.getAttribute("aria-valuenow")).toBe("2");
		expect(meter.getAttribute("aria-valuemax")).toBe("3");
		expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/dashboard/settings/billing");
	});

	it("tells a member on Free who can upgrade", async () => {
		billing = "free";
		role = "member";
		renderAt("/dashboard");
		expect(await screen.findByRole("meter", { name: "Jobs this month" })).toBeTruthy();
		expect(screen.getByText("Ask an admin for more jobs.")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
	});
});

describe("collapsing the sidebar", () => {
	it("collapses to a rail with the button, keeps every link named, and remembers the choice", async () => {
		renderAt("/dashboard");
		const toggle = await screen.findByRole("button", { name: "Collapse sidebar" });
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(toggle);
		expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
		expect(localStorage.getItem("lucidhire.sidebar")).toBe("collapsed");
		expect(screen.queryByRole("link", { name: "Pro plan, see plans" })).toBeNull();
		const sidebar = within(screen.getByRole("complementary", { name: "Sidebar" }));
		expect(sidebar.getByRole("link", { name: "Jobs" })).toBeTruthy();
		expect(sidebar.getByRole("link", { name: "Post a job" })).toBeTruthy();
		expect(sidebar.getByRole("button", { name: "Search or jump to" })).toBeTruthy();
		expect(sidebar.getByText("Sprite Labs, your role: Admin").className).toContain("sr-only");
	});

	it("starts collapsed when it was left collapsed", async () => {
		localStorage.setItem("lucidhire.sidebar", "collapsed");
		renderAt("/dashboard");
		expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeTruthy();
	});

	it("toggles with Ctrl+B and Cmd+B, but not while typing in a field", async () => {
		renderAt("/dashboard/jobs/new");
		await screen.findByRole("button", { name: "Collapse sidebar" });

		press("b", { ctrlKey: true });
		expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
		press("b", { metaKey: true });
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
	});
});

describe("command palette", () => {
	it("opens with Ctrl+K, moves with the arrow keys, runs with Enter and closes", async () => {
		const router = renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });

		press("k", { ctrlKey: true });
		const palette = await screen.findByRole("dialog", { name: "Search and commands" });
		const input = within(palette).getByRole("combobox");
		expect(document.activeElement).toBe(input);
		const active = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent;
		expect(active()).toContain("Overview");

		fireEvent.keyDown(input, { key: "ArrowDown" });
		expect(active()).toContain("Jobs");
		fireEvent.keyDown(input, { key: "ArrowUp" });
		fireEvent.keyDown(input, { key: "ArrowUp" });
		expect(active()).toContain("Sign out");
		fireEvent.keyDown(input, { key: "Home" });
		fireEvent.keyDown(input, { key: "ArrowDown" });
		fireEvent.keyDown(input, { key: "Enter" });

		expect(screen.queryByRole("dialog")).toBeNull();
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs"));
	});

	it("searches jobs and candidates and filters the commands", async () => {
		const router = renderAt("/dashboard");
		fireEvent.click(await screen.findByRole("button", { name: /Search or jump to/ }));
		const palette = await screen.findByRole("dialog", { name: "Search and commands" });
		fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "grace" } });

		const candidates = await within(palette).findByRole("group", { name: "Candidates" });
		const grace = within(candidates).getByRole("option", { name: /Grace Hopper/ });
		expect(grace.textContent).toContain("91");
		expect(grace.textContent).toContain("Shortlisted");
		expect(within(palette).getByRole("group", { name: "Jobs" })).toBeTruthy();

		fireEvent.click(grace);
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs/job_2/candidates/c_1"));
	});

	it("closes on Escape and gives focus back, and Ctrl+K again closes it", async () => {
		renderAt("/dashboard");
		const field = await screen.findByRole("button", { name: /Search or jump to/ });
		field.focus();
		fireEvent.click(field);
		await screen.findByRole("dialog", { name: "Search and commands" });
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(field);

		press("k", { metaKey: true });
		const input = within(await screen.findByRole("dialog", { name: "Search and commands" })).getByRole("combobox");
		fireEvent.keyDown(input, { key: "k", ctrlKey: true });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("chooses a job for Upload CVs to…, and goes back with Backspace", async () => {
		const router = renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });
		press("k", { ctrlKey: true });
		const palette = await screen.findByRole("dialog", { name: "Search and commands" });
		const input = within(palette).getByRole("combobox");
		fireEvent.click(within(palette).getByRole("option", { name: /Upload CVs to/ }));

		const open = await within(palette).findByRole("group", { name: "Open jobs" });
		expect(within(open).getAllByRole("option").map((option) => option.textContent)).toEqual([
			expect.stringContaining("Open role"),
			expect.stringContaining("Older open"),
		]);
		fireEvent.keyDown(input, { key: "Backspace" });
		expect(within(palette).getByRole("group", { name: "Go to" })).toBeTruthy();

		fireEvent.click(within(palette).getByRole("option", { name: /Upload CVs to/ }));
		fireEvent.click(await within(palette).findByRole("option", { name: /Older open/ }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1"));
		expect(router.state.location.hash).toBe("upload");
	});
});

describe("keyboard shortcuts", () => {
	it("lists the shortcuts with ?, and closes on Escape", async () => {
		renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });
		press("?", { shiftKey: true });
		const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
		const global = within(within(help).getByRole("region", { name: "Global" }));
		expect(global.getByText("Search or run a command")).toBeTruthy();
		expect(global.getByText("Go to Jobs")).toBeTruthy();
		expect(global.getByText("Collapse or expand the sidebar")).toBeTruthy();
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("goes to a section with g then a letter, and posts a job with n", async () => {
		const router = renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });
		press("g");
		press("j");
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs"));
		press("g");
		press("o");
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
		press("n");
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs/new"));

		// Typing in a field types.
		const title = await screen.findByLabelText("Job title");
		fireEvent.keyDown(title, { key: "g" });
		fireEvent.keyDown(title, { key: "j" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");
	});
});

describe("account menu", () => {
	it("switches the theme, keeps the choice, and links to account, billing and sign-out", async () => {
		renderAt("/dashboard");
		fireEvent.click(await screen.findByRole("button", { name: "Account: Grace Turner, Admin" }));
		const menu = await screen.findByRole("menu");
		expect(within(menu).getByText("grace@sprite.test")).toBeTruthy();
		expect(within(menu).getByRole("menuitemradio", { name: "System" }).getAttribute("aria-checked")).toBe("true");

		fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dark" }));
		expect(localStorage.getItem("lh-theme")).toBe("dark");
		await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
		// Choosing a theme keeps the menu open, so the change can be seen.
		expect(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");

		expect(within(menu).getByRole("menuitem", { name: "Account settings" }).getAttribute("href")).toBe("/dashboard/settings/account");
		expect(within(menu).getByRole("menuitem", { name: "Plan & billing" }).getAttribute("href")).toBe("/dashboard/settings/billing");
		expect(within(menu).getByRole("menuitem", { name: "Sign out" }).getAttribute("href")).toBe("/sign-out");
	});

	it("takes the dark class off when leaving the dashboard", async () => {
		setThemePreference("dark");
		const router = renderAt("/dashboard");
		await screen.findByRole("navigation", { name: "Main" });
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		await act(async () => {
			await router.navigate({ to: "/terms" });
		});
		await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
	});
});

describe("phone layout", () => {
	it("shows a top bar and a tab bar instead of the sidebar", async () => {
		stubPhone();
		renderAt("/dashboard/jobs/job_2");
		const tabs = await screen.findByRole("navigation", { name: "Main" });
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
		expect(within(tabs).getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("true");
		expect(within(tabs).getByRole("link", { name: /^Candidates/ }).textContent).toContain("Candidates");
		expect(within(tabs).getByRole("button", { name: "Search" })).toBeTruthy();
		expect(within(tabs).getByRole("button", { name: "More" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to jobs" }).getAttribute("href")).toBe("/dashboard/jobs");
	});

	it("opens More as a sheet that traps focus, closes on Escape with focus back, and after choosing a page", async () => {
		stubPhone();
		const router = renderAt("/dashboard");
		const more = await screen.findByRole("button", { name: "More" });
		more.focus();
		fireEvent.click(more);
		const sheet = await screen.findByRole("dialog", { name: "More" });
		expect(sheet.contains(document.activeElement)).toBe(true);
		expect(await within(sheet).findByRole("link", { name: "Pro plan, see plans" })).toBeTruthy();
		expect(within(sheet).getByRole("link", { name: "Sign out" }).getAttribute("href")).toBe("/sign-out");

		const focusable = sheet.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])");
		focusable[focusable.length - 1].focus();
		fireEvent.keyDown(document, { key: "Tab" });
		expect(document.activeElement).toBe(focusable[0]);
		fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(focusable[focusable.length - 1]);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(more);

		fireEvent.click(more);
		fireEvent.click(within(await screen.findByRole("dialog", { name: "More" })).getByRole("link", { name: "Settings" }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/settings"));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("opens the account sheet from the avatar", async () => {
		stubPhone();
		renderAt("/dashboard");
		fireEvent.click(await screen.findByRole("button", { name: "Account: Grace Turner" }));
		const sheet = await screen.findByRole("dialog", { name: "Account" });
		expect(within(sheet).getByText("Grace Turner")).toBeTruthy();
		expect(within(sheet).getByRole("radio", { name: "Light" })).toBeTruthy();
		expect(within(sheet).getByRole("link", { name: "Account settings" }).getAttribute("href")).toBe("/dashboard/settings/account");
	});
});
