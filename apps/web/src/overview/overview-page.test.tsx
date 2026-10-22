import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overview } from "../lib/overview.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	RedirectToSignIn: () => null,
	UserButton: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

const DAYS = Array.from({ length: 10 }, (_, i) => `2026-10-${String(13 + i).padStart(2, "0")}`);
const zeros: Overview = {
	kpis: {
		activeRoles: { value: 0, change: 0 },
		cvsScreened: { value: 0, thisMonth: 0, lastMonth: 0 },
		avgTimeToShortlist: { hours: null, previousHours: null },
		topMatch: null,
	},
	velocity: { days: DAYS.map((date) => ({ date, uploaded: 0 })), totals: { received: 0, scored: 0, shortlisted: 0 } },
	funnel: { received: 0, scored: 0, shortlisted: 0 },
	aiMix: { scoring: 0, descriptionRewrites: 0, interviewQuestions: 0 },
	activity: [],
};
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const busy: Overview = {
	kpis: {
		activeRoles: { value: 5, change: 3 },
		cvsScreened: { value: 120, thisMonth: 40, lastMonth: 55 },
		avgTimeToShortlist: { hours: 6.4, previousHours: 9.4 },
		topMatch: { score: 94, candidateName: "Ada Lovelace", candidateId: "c_ada", jobId: "job_1", jobTitle: "Staff Engineer" },
	},
	velocity: {
		days: DAYS.map((date, i) => ({ date, uploaded: i === 6 ? 7 : i % 3 })),
		totals: { received: 80, scored: 70, shortlisted: 14 },
	},
	funnel: { received: 80, scored: 70, shortlisted: 14 },
	aiMix: { scoring: 70, descriptionRewrites: 5, interviewQuestions: 25 },
	activity: [
		{ type: "cv_scored", at: minutesAgo(5), jobId: "job_1", jobTitle: "Staff Engineer", candidateId: "c_ada", text: "Ada Lovelace was scored for Staff Engineer" },
		{ type: "job_created", at: minutesAgo(180), jobId: "job_1", jobTitle: "Staff Engineer", text: "Job posted: Staff Engineer" },
		{ type: "description_rewritten", at: minutesAgo(0.2), jobId: null, jobTitle: null, text: "A job description was rewritten with AI" },
	],
};

let overview: Overview | "fail";
let calls: number;

beforeEach(() => {
	overview = busy;
	calls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url).pathname;
			if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role: "admin" } });
			if (path === "/jobs") return Response.json({ jobs: [], total: 0, page: 1, pageSize: 20 });
			if (path === "/overview") {
				calls += 1;
				return overview === "fail"
					? Response.json({ error: { code: "internal_error", message: "Something went wrong on our side. Try again." } }, { status: 500 })
					: Response.json(overview);
			}
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		}),
	);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderOverview() {
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dashboard/overview"] }));
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

describe("overview page", () => {
	it("is the Overview page, with Post a job and the sidebar item marked", { timeout: 15_000 }, async () => {
		renderOverview();
		// The first test also loads the page's code, which can be slow on a busy machine.
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" }, { timeout: 4000 })).toBeTruthy();
		const main = within(screen.getByRole("main"));
		expect(main.getByRole("link", { name: /Post a job/ }).getAttribute("href")).toBe("/dashboard/jobs/new");
		const nav = within(screen.getByRole("navigation", { name: "Main" }));
		expect(nav.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
		expect(nav.getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBeNull();
	});

	it("shows the four key numbers with changes written out", async () => {
		renderOverview();
		await screen.findByRole("heading", { name: "Pipeline velocity" });
		const kpis = within(screen.getByRole("region", { name: "Key numbers" }));

		expect(kpis.getByText("Active roles").nextElementSibling?.textContent).toBe("5");
		expect(kpis.getByText("+3 vs last month opened")).toBeTruthy();
		expect(kpis.getByText("120")).toBeTruthy();
		expect(kpis.getByText("−15 vs last month")).toBeTruthy();
		expect(kpis.getByText("6.4 h")).toBeTruthy();
		expect(kpis.getByText("3.0 h faster than the 30 days before")).toBeTruthy();
		expect(kpis.getByText("94")).toBeTruthy();
		expect(kpis.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/c_ada");
		expect(kpis.getByRole("link", { name: "Staff Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
	});

	it("draws the velocity bars with labels, a table fallback and the 90-day totals", async () => {
		renderOverview();
		const card = within(await screen.findByRole("region", { name: "Pipeline velocity" }));

		expect(card.getByRole("img", { name: /CVs uploaded per day/ })).toBeTruthy();
		expect(card.getByText("19 Oct: 7 CVs uploaded")).toBeTruthy();
		expect(card.getByText("13 Oct: 0 CVs uploaded")).toBeTruthy();
		expect(card.getByText("14 Oct: 1 CV uploaded")).toBeTruthy();
		const table = card.getByRole("table", { name: /CVs uploaded per day/ });
		expect(within(table).getAllByRole("row")).toHaveLength(11);
		expect(within(table).getByRole("row", { name: "19 Oct 7" })).toBeTruthy();
		expect(card.getByText("80")).toBeTruthy();
		expect(card.getByText("Last 90 days")).toBeTruthy();
	});

	it("shows the funnel with conversion, and the AI mix with counts", async () => {
		renderOverview();
		const funnel = within(await screen.findByRole("region", { name: "90-day funnel" }));
		expect(funnel.getByText(/88% of received/)).toBeTruthy();
		expect(funnel.getByText(/20% of scored/)).toBeTruthy();

		const mix = within(screen.getByRole("region", { name: "AI output mix" }));
		expect(mix.getByText("CV scoring").parentElement?.textContent).toContain("70");
		expect(mix.getByText("Description rewrites")).toBeTruthy();
		expect(mix.getByText("Interview questions").parentElement?.textContent).toContain("25");
	});

	it("lists recent activity with relative times and links to the candidate or job", async () => {
		renderOverview();
		const activity = within(await screen.findByRole("region", { name: "Recent activity" }));

		expect(activity.getByText("Just now")).toBeTruthy();
		expect(activity.getByText("5 min ago")).toBeTruthy();
		expect(activity.getByText("3 h ago")).toBeTruthy();
		expect(activity.getByRole("link", { name: "Ada Lovelace was scored for Staff Engineer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_1/candidates/c_ada",
		);
		expect(activity.getByRole("link", { name: "Job posted: Staff Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
		expect(activity.queryByRole("link", { name: /rewritten with AI/ })).toBeNull();
		expect(activity.getByRole("link", { name: /View all jobs/ }).getAttribute("href")).toBe("/dashboard");
	});

	it("gives every card its own empty state for a company with no data", async () => {
		overview = zeros;
		renderOverview();
		await screen.findByRole("heading", { name: "Pipeline velocity" });

		const kpis = within(screen.getByRole("region", { name: "Key numbers" }));
		expect(kpis.getByText("No open jobs. Open one to take CVs.")).toBeTruthy();
		expect(kpis.getByText("Scored CVs are counted here.")).toBeTruthy();
		expect(kpis.getByText("Shortlist a CV to see this")).toBeTruthy();
		expect(kpis.getByText("The best scored CV shows here.")).toBeTruthy();
		expect(screen.getByText(/No CVs uploaded in the last 10 days/)).toBeTruthy();
		expect(screen.getByText(/the funnel fills in/)).toBeTruthy();
		expect(screen.getByText(/Scored CVs, rewritten descriptions and interview questions show here/)).toBeTruthy();
		expect(screen.getByText(/Nothing has happened yet/)).toBeTruthy();
		expect(screen.getByRole("link", { name: /View all jobs/ })).toBeTruthy();
	});

	it("says what went wrong and tries again", async () => {
		overview = "fail";
		renderOverview();
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("We couldn't load your overview");
		expect(alert.textContent).toContain("Something went wrong on our side. Try again.");

		overview = busy;
		fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
		expect(await screen.findByRole("heading", { name: "Pipeline velocity" })).toBeTruthy();
		expect(calls).toBe(2);
	});
});
