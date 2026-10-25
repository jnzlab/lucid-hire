import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCounts } from "../lib/jobs.ts";
import type {
	ActivityEvent,
	FunnelCounts,
	OverviewAiMix,
	OverviewAttention,
	OverviewKpis,
	OverviewVelocity,
} from "../lib/overview.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	// The dashboard's account menu reads the name and email; without a user it shows "Your account".
	useUser: () => ({ isLoaded: true, user: null }),
	RedirectToSignIn: () => null,
	UserButton: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

// What the six card endpoints answer between them.
type Overview = {
	attention: OverviewAttention;
	kpis: OverviewKpis;
	velocity: OverviewVelocity;
	funnel: FunnelCounts;
	aiMix: OverviewAiMix;
	activity: ActivityEvent[];
};

const DAYS = Array.from({ length: 10 }, (_, i) => `2026-10-${String(13 + i).padStart(2, "0")}`);
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const candidate = (candidateId: string, name: string, headline: string, score: number) => ({
	candidateId,
	name,
	fileName: `${candidateId}.pdf`,
	headline,
	score,
});

const quietQueue: OverviewAttention = {
	totals: { toReview: 0, reading: 0, failed: 0, openJobs: 0, jobsToReview: 0 },
	waiting: [],
	failed: [],
	emptyOpenJobs: [],
	drafts: [],
	bestNew: [],
};
const busyQueue: OverviewAttention = {
	totals: { toReview: 14, reading: 2, failed: 3, openJobs: 4, jobsToReview: 3 },
	waiting: [
		{
			jobId: "job_1",
			jobTitle: "Staff Engineer",
			toReview: 8,
			shortlisted: 3,
			reading: 1,
			top: [
				candidate("c_ada", "Ada Lovelace", "Staff Engineer · London", 94),
				candidate("c_grace", "Grace Hopper", "Principal Engineer · New York", 88),
				candidate("c_alan", "Alan Turing", "Engineer · Manchester", 81),
			],
		},
		{ jobId: "job_2", jobTitle: "iOS Developer", toReview: 4, shortlisted: 0, reading: 0, top: [candidate("c_kenji", "Kenji Tanaka", "iOS Developer · Tokyo", 77)] },
		{ jobId: "job_4", jobTitle: "Support Lead", toReview: 0, shortlisted: 1, reading: 1, top: [] },
	],
	failed: [
		{ jobId: "job_1", jobTitle: "Staff Engineer", count: 2 },
		{ jobId: "job_5", jobTitle: "Old Role", count: 1 },
	],
	emptyOpenJobs: [{ jobId: "job_6", jobTitle: "Data Analyst", slug: "data-analyst-x1" }],
	drafts: [{ jobId: "job_7", jobTitle: "Product Designer", updatedAt: minutesAgo(5) }],
	bestNew: [
		{ candidateId: "c_ada", jobId: "job_1", jobTitle: "Staff Engineer", name: "Ada Lovelace", fileName: "ada.pdf", headline: "Staff Engineer · London", score: 94, decision: "shortlisted", scoredAt: minutesAgo(60) },
		{ candidateId: "c_kenji", jobId: "job_2", jobTitle: "iOS Developer", name: "Kenji Tanaka", fileName: "kenji.pdf", headline: "Senior iOS Engineer · Tokyo", score: 77, decision: "undecided", scoredAt: minutesAgo(90) },
		{ candidateId: "c_lucas", jobId: "job_2", jobTitle: "iOS Developer", name: null, fileName: "lucas_becker.pdf", headline: null, score: 61, decision: "rejected", scoredAt: minutesAgo(120) },
	],
};

const zeros: Overview = {
	attention: quietQueue,
	kpis: {
		activeRoles: { value: 0, change: 0 },
		cvsScreened: { value: 0, thisMonth: 0, lastMonth: 0 },
		awaitingDecision: { value: 0, scoredThisWeek: 0 },
		topMatch: null,
	},
	velocity: { days: DAYS.map((date) => ({ date, uploaded: 0 })), totals: { received: 0, scored: 0, shortlisted: 0 } },
	funnel: { received: 0, scored: 0, shortlisted: 0 },
	aiMix: { scoring: 0, descriptionRewrites: 0, interviewQuestions: 0 },
	activity: [],
};
const busy: Overview = {
	attention: busyQueue,
	kpis: {
		activeRoles: { value: 5, change: 3 },
		cvsScreened: { value: 120, thisMonth: 40, lastMonth: 55 },
		awaitingDecision: { value: 8, scoredThisWeek: 3 },
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

const openJob = (id: string, title: string, slug: string) => ({
	id,
	slug,
	title,
	status: "open",
	cvCount: 0,
	hasCover: false,
	createdAt: minutesAgo(600),
	updatedAt: minutesAgo(600),
	scoredCount: 0,
	toReviewCount: 0,
	shortlistedCount: 0,
	rejectedCount: 0,
	readingCount: 0,
	failedCount: 0,
	topScore: null,
	topCandidate: null,
	lastCvAt: null,
});

let overview: Overview;
// What GET /jobs answers (the sidebar's open jobs, which also count every job the company has).
let jobCounts: JobCounts;
let openJobs: ReturnType<typeof openJob>[];
// The card endpoints that answer with an error, and how often each was asked.
let failing: Set<string>;
// The card endpoints that never answer.
let stalled: Set<string>;
let calls: Record<string, number>;

beforeEach(() => {
	overview = busy;
	jobCounts = { all: 9, open: 2, draft: 1, closed: 6 };
	openJobs = [openJob("job_1", "Staff Engineer", "staff-engineer-a1"), openJob("job_6", "Data Analyst", "data-analyst-x1")];
	failing = new Set();
	stalled = new Set();
	calls = {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url).pathname;
			if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role: "admin" } });
			if (path === "/jobs") {
				return Response.json({ jobs: openJobs, total: openJobs.length, page: 1, pageSize: 20, counts: jobCounts });
			}
			const card = path.match(/^\/overview\/([a-z-]+)$/)?.[1];
			if (card) {
				calls[card] = (calls[card] ?? 0) + 1;
				if (stalled.has(card)) return new Promise<Response>(() => {});
				if (failing.has(card)) {
					return Response.json({ error: { code: "internal_error", message: "Something went wrong on our side. Try again." } }, { status: 500 });
				}
				const answers: Record<string, unknown> = {
					attention: overview.attention,
					kpis: overview.kpis,
					velocity: overview.velocity,
					funnel: overview.funnel,
					"ai-mix": overview.aiMix,
					activity: { events: overview.activity },
				};
				return Response.json(answers[card]);
			}
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		}),
	);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(navigator, "clipboard");
});

const clipboard = (writeText: (text: string) => Promise<void>) =>
	Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

function renderOverview(path = "/dashboard") {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

const main = () => within(screen.getByRole("main"));
const region = (name: string) => within(screen.getByRole("region", { name }));
// The line under the h1.
const summary = () => screen.getByRole("heading", { level: 1, name: "Overview" }).nextElementSibling;

// Every card has its numbers once none says it is loading.
const cardsLoaded = async () => {
	await screen.findByRole("heading", { level: 1, name: "Overview" }, { timeout: 4000 });
	// queryAll: several cards can still be loading at once, and a busy machine needs more than the default second.
	await waitFor(() => expect(screen.queryAllByText(/^Loading /)).toHaveLength(0), { timeout: 4000 });
	await screen.findByRole("region", { name: "Key numbers" });
};

describe("overview page", () => {
	it("is the Overview page, with Post a job and the sidebar item marked", { timeout: 15_000 }, async () => {
		renderOverview();
		// The first test also loads the page's code, which can be slow on a busy machine.
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" }, { timeout: 4000 })).toBeTruthy();
		await cardsLoaded();
		expect(main().getByRole("link", { name: /Post a job/ }).getAttribute("href")).toBe("/dashboard/jobs/new");
		const nav = within(screen.getByRole("navigation", { name: "Main" }));
		expect(nav.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
		expect(nav.getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBeNull();
	});

	it("takes the old /dashboard/overview address to /dashboard", async () => {
		const router = renderOverview("/dashboard/overview");
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" }, { timeout: 4000 })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
	});

	it("says in one sentence what is waiting, marking the number to decide on", async () => {
		renderOverview();
		await cardsLoaded();
		expect(summary()?.textContent).toBe("14 candidates are waiting for your decision across 3 jobs. 2 CVs are being read.");
		expect(summary()?.querySelector(".mk")?.textContent).toBe("14 candidates");
	});

	it("lists the jobs waiting for you, each with its best CVs to review and a Review button", async () => {
		renderOverview();
		await cardsLoaded();
		const waiting = region("Waiting for you");
		expect(waiting.getByText("14").closest(".count-badge")?.textContent).toBe("14 to review");
		expect(waiting.getByRole("link", { name: /All to review/ }).getAttribute("href")).toBe("/dashboard/candidates?decision=review");

		const cards = waiting.getAllByRole("article");
		expect(cards).toHaveLength(3);
		const staff = within(cards[0]);
		expect(staff.getByRole("heading", { level: 3, name: "Staff Engineer" })).toBeTruthy();
		expect(staff.getByRole("link", { name: "Staff Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
		expect(staff.getByText(/8 to review · 3 shortlisted/)).toBeTruthy();
		expect(staff.getByText("1 reading")).toBeTruthy();
		expect(staff.getByRole("link", { name: "Review 8 candidates for Staff Engineer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_1?show=review",
		);
		const top = within(staff.getByRole("list", { name: "Best to review for Staff Engineer" }));
		const rows = top.getAllByRole("link");
		expect(rows).toEqual([
			top.getByRole("link", { name: "Ada Lovelace, Staff Engineer · London, score 94" }),
			top.getByRole("link", { name: "Grace Hopper, Principal Engineer · New York, score 88" }),
			top.getByRole("link", { name: "Alan Turing, Engineer · Manchester, score 81" }),
		]);
		expect(rows[0].getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/c_ada");

		// A job whose CVs are all still being read says so, and opens the job instead.
		const support = within(cards[2]);
		expect(support.getByText(/Reading 1 CV\./).parentElement?.textContent).toBe("Reading 1 CV. They show here once they're scored.");
		expect(support.getByRole("link", { name: "Open job Support Lead" }).getAttribute("href")).toBe("/dashboard/jobs/job_4");
		expect(support.queryByRole("link", { name: /^Review/ })).toBeNull();

		// 14 to review, 12 of them on the listed jobs.
		expect(waiting.getByText(/2 more CVs are waiting on other jobs/)).toBeTruthy();
		expect(waiting.getByRole("link", { name: "See every CV to review" }).getAttribute("href")).toBe("/dashboard/candidates?decision=review");
	});

	it("lists what needs attention, each with its one action", async () => {
		const writeText = vi.fn(async () => {});
		clipboard(writeText);
		renderOverview();
		await cardsLoaded();
		const attention = region("Needs attention");
		const rows = attention.getAllByRole("listitem");
		expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
			"2 CVs couldn't be read for Staff Engineer",
			"1 CV couldn't be read for Old Role",
			"Data Analyst has no CVs yet",
			"Product Designer is a draft",
		]);
		expect(within(rows[0]).getByRole("link", { name: "Review the CVs that couldn't be read for Staff Engineer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_1?show=failed",
		);
		expect(within(rows[2]).getByRole("link", { name: "Upload CVs to Data Analyst" }).getAttribute("href")).toBe("/dashboard/jobs/job_6#upload");
		expect(within(rows[3]).getByText("Edited 5 min ago")).toBeTruthy();
		expect(within(rows[3]).getByRole("link", { name: "Finish and open Product Designer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_7/edit",
		);

		fireEvent.click(within(rows[2]).getByRole("button", { name: "Copy apply link for Data Analyst" }));
		expect(writeText).toHaveBeenCalledWith("https://lucidhire.io/jobs/data-analyst-x1");
		expect(await screen.findByText("Apply link copied for Data Analyst")).toBeTruthy();
	});

	it("says so in a toast when the apply link can't be copied", async () => {
		clipboard(async () => {
			throw new Error("denied");
		});
		renderOverview();
		await cardsLoaded();
		fireEvent.click(region("Needs attention").getByRole("button", { name: "Copy apply link for Data Analyst" }));
		expect((await screen.findByText(/the link\. Open the job and copy it from there\./)).textContent).toContain("Couldn't copy the link.");
	});

	it("shows five things that need attention, and the rest on request", async () => {
		overview = {
			...busy,
			attention: {
				...busyQueue,
				drafts: ["A", "B", "C", "D"].map((letter, i) => ({ jobId: `draft_${i}`, jobTitle: `Draft ${letter}`, updatedAt: minutesAgo(60) })),
			},
		};
		renderOverview();
		await cardsLoaded();
		const attention = region("Needs attention");
		expect(attention.getAllByRole("listitem")).toHaveLength(5);
		const more = attention.getByRole("button", { name: "Show all 7" });
		expect(more.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(more);
		expect(attention.getAllByRole("listitem")).toHaveLength(7);
		expect(attention.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
	});

	it("ranks the best new matches, with the top one on the marker band and the page's only ring", async () => {
		renderOverview();
		await cardsLoaded();
		const best = region("Best new matches");
		expect(best.getByText("Scored in the last 7 days")).toBeTruthy();
		const rows = best.getAllByRole("link");
		expect(rows).toHaveLength(3);
		expect(rows[0].className).toContain("rank-band");
		expect(rows[1].className).not.toContain("rank-band");
		expect(rows[0].getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/c_ada");
		expect(best.getByRole("link", { name: /^Rank 1: Ada Lovelace/ })).toBe(rows[0]);
		// The headline's first part is dropped when it repeats the job title.
		expect(within(rows[0]).getByText("Staff Engineer · London")).toBeTruthy();
		expect(within(rows[0]).getByText("Shortlisted")).toBeTruthy();
		expect(within(rows[1]).getByText("iOS Developer · Senior iOS Engineer · Tokyo")).toBeTruthy();
		expect(within(rows[1]).queryByText(/Decision:/)).toBeNull();
		// A CV without a name shows its file name.
		expect(within(rows[2]).getByText("lucas_becker.pdf")).toBeTruthy();
		expect(within(rows[2]).getByText("Not a fit")).toBeTruthy();

		const rings = document.querySelectorAll(".score-ring");
		expect(rings).toHaveLength(1);
		expect(rows[0].contains(rings[0])).toBe(true);
	});

	it("shows the three key numbers with changes written out, and no Top match", async () => {
		renderOverview();
		await cardsLoaded();
		const kpis = region("Key numbers");
		expect(kpis.getByText("Active roles").nextElementSibling?.textContent).toBe("5");
		expect(kpis.getByText("+3 opened vs last month")).toBeTruthy();
		expect(kpis.getByText("CVs screened").nextElementSibling?.textContent).toBe("120");
		expect(kpis.getByText("−15 vs last month")).toBeTruthy();
		expect(kpis.getByText("Awaiting a decision").nextElementSibling?.textContent).toBe("8");
		const awaiting = kpis.getByRole("link", { name: /Awaiting a decision/ });
		expect(awaiting.getAttribute("href")).toBe("/dashboard/candidates?decision=review");
		expect(awaiting.textContent).toContain("3 scored this week · Review");
		expect(kpis.queryByText(/Top match/i)).toBeNull();
	});

	it("draws the uploads per day with a table fallback, and the funnel with its conversion", async () => {
		renderOverview();
		await cardsLoaded();
		const pipeline = region("Pipeline");
		expect(pipeline.getByRole("img", { name: /CVs uploaded per day over the last 10 days: 16 CVs in total, the most on 19 Oct with 7/ })).toBeTruthy();
		expect(pipeline.getByTitle("19 Oct: 7 CVs uploaded")).toBeTruthy();
		expect(pipeline.getByTitle("14 Oct: 1 CV uploaded")).toBeTruthy();
		expect(pipeline.getByText("in 10 days").textContent).toBe("16 in 10 days");
		const table = pipeline.getByRole("table", { name: /CVs uploaded per day/ });
		expect(within(table).getAllByRole("row")).toHaveLength(11);
		expect(within(table).getByRole("row", { name: "19 Oct 7" })).toBeTruthy();

		expect(pipeline.getByText(/88% of received/)).toBeTruthy();
		expect(pipeline.getByText(/20% of scored/)).toBeTruthy();
	});

	it("shows the AI usage with counts", async () => {
		renderOverview();
		await cardsLoaded();
		const mix = region("AI usage");
		expect(mix.getByText("CV scoring").parentElement?.textContent).toContain("70");
		expect(mix.getByText("Description rewrites")).toBeTruthy();
		expect(mix.getByText("Interview questions").parentElement?.textContent).toContain("25");
	});

	it("lists recent activity with relative times and links to the candidate or job", async () => {
		renderOverview();
		await cardsLoaded();
		const activity = region("Recent activity");

		expect(activity.getByText("Just now")).toBeTruthy();
		expect(activity.getByText("5 min ago")).toBeTruthy();
		expect(activity.getByText("3 h ago")).toBeTruthy();
		expect(activity.getByRole("link", { name: "Ada Lovelace was scored for Staff Engineer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_1/candidates/c_ada",
		);
		expect(activity.getByRole("link", { name: "Job posted: Staff Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
		expect(activity.queryByRole("link", { name: /rewritten with AI/ })).toBeNull();
		expect(activity.queryByRole("button", { name: /Show all/ })).toBeNull();
	});

	it("shows five events and opens the rest with Show all", async () => {
		overview = {
			...busy,
			activity: Array.from({ length: 8 }, (_, i) => ({
				type: "cvs_uploaded" as const,
				at: minutesAgo(i * 10 + 1),
				jobId: "job_1",
				jobTitle: "Staff Engineer",
				text: `Upload ${i + 1}`,
			})),
		};
		renderOverview();
		await cardsLoaded();
		const activity = region("Recent activity");
		expect(activity.getAllByRole("listitem")).toHaveLength(5);
		fireEvent.click(activity.getByRole("button", { name: "Show all 8" }));
		expect(activity.getAllByRole("listitem")).toHaveLength(8);
		expect(activity.getByRole("link", { name: "Upload 8" })).toBeTruthy();
	});

	it("is the all-clear when nothing waits and nothing needs attention, with ways to bring in CVs", async () => {
		const writeText = vi.fn(async () => {});
		clipboard(writeText);
		overview = { ...busy, attention: { ...quietQueue, totals: { ...quietQueue.totals, openJobs: 2 } } };
		renderOverview();
		await cardsLoaded();
		expect(summary()?.textContent).toBe("You're up to date.");
		const waiting = region("Waiting for you");
		expect(waiting.getByRole("heading", { level: 3, name: "You're up to date" })).toBeTruthy();
		expect(waiting.getByText("New CVs show here as soon as they're read.")).toBeTruthy();
		expect(waiting.queryByRole("link", { name: /All to review/ })).toBeNull();
		expect(waiting.getByRole("link", { name: /Post a job/ }).getAttribute("href")).toBe("/dashboard/jobs/new");
		expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
		expect(region("Best new matches").getByText(/No CVs were scored in the last 7 days/)).toBeTruthy();

		fireEvent.click(waiting.getByRole("button", { name: "Share a job" }));
		const menu = within(await screen.findByRole("menu"));
		expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Staff Engineer", "Data Analyst"]);
		fireEvent.click(menu.getByRole("menuitem", { name: "Data Analyst" }));
		expect(writeText).toHaveBeenCalledWith("https://lucidhire.io/jobs/data-analyst-x1");
		expect(await screen.findByText("Apply link copied for Data Analyst")).toBeTruthy();
	});

	it("offers only Post a job in the all-clear when no job is open", async () => {
		openJobs = [];
		overview = { ...busy, attention: quietQueue };
		renderOverview();
		await cardsLoaded();
		const waiting = region("Waiting for you");
		expect(waiting.getByRole("heading", { level: 3, name: "You're up to date" })).toBeTruthy();
		expect(waiting.queryByRole("button", { name: "Share a job" })).toBeNull();
		expect(waiting.getByRole("link", { name: /Post a job/ }).className.split(" ")).not.toContain("ghost");
	});

	it("keeps it quiet when nothing waits but something needs attention", async () => {
		overview = {
			...busy,
			attention: { ...quietQueue, totals: { ...quietQueue.totals, failed: 3 }, failed: busyQueue.failed },
		};
		renderOverview();
		await cardsLoaded();
		expect(summary()?.textContent).toBe("Nothing is waiting for your decision. 3 CVs couldn't be read.");
		const waiting = region("Waiting for you");
		expect(waiting.getByRole("heading", { level: 3, name: "Nothing waiting for a decision" })).toBeTruthy();
		expect(waiting.queryByRole("button", { name: "Share a job" })).toBeNull();
		expect(region("Needs attention").getAllByRole("listitem")).toHaveLength(2);
	});

	it("gives a brand-new company its first steps instead of empty charts", async () => {
		jobCounts = { all: 0, open: 0, draft: 0, closed: 0 };
		openJobs = [];
		overview = zeros;
		renderOverview();
		const start = await screen.findByRole("region", { name: "Get started" }, { timeout: 4000 });
		expect(summary()?.textContent).toBe("Three steps to your first ranked shortlist.");
		expect(within(start).getByRole("heading", { level: 2, name: "Post your first job" })).toBeTruthy();
		expect(main().getAllByRole("link", { name: /Post a job/ })).toHaveLength(1);
		expect(within(start).getByRole("link", { name: /Post a job/ }).getAttribute("href")).toBe("/dashboard/jobs/new");
		const steps = within(start).getAllByRole("listitem");
		expect(steps.map((step) => step.querySelector("p + p")?.textContent)).toEqual([
			"Post a job",
			"Share the apply link",
			"Review the ranked list",
		]);
		expect(steps[0].getAttribute("aria-current")).toBe("step");

		for (const name of ["Waiting for you", "Key numbers", "Pipeline", "AI usage", "Recent activity"]) {
			expect(screen.queryByRole("region", { name })).toBeNull();
		}
		// The charts' numbers aren't even asked for; the work queue is, once, for the sidebar's badge.
		expect(calls).toEqual({ attention: 1 });
	});

	it("gives every card its own short empty state for a company with jobs but no CVs", async () => {
		overview = zeros;
		renderOverview();
		await cardsLoaded();

		const kpis = region("Key numbers");
		expect(kpis.getByText("No open jobs. Open one to take CVs.")).toBeTruthy();
		expect(kpis.getByText("Scored CVs are counted here.")).toBeTruthy();
		expect(kpis.getByText("Nothing waiting. Scored CVs land here.")).toBeTruthy();
		expect(kpis.getByText("Awaiting a decision").nextElementSibling?.textContent).toBe("0");
		const pipeline = region("Pipeline");
		expect(pipeline.getByText(/No CVs uploaded in the last 10 days/)).toBeTruthy();
		expect(pipeline.queryByRole("img")).toBeNull();
		expect(pipeline.getByText(/the funnel fills in/)).toBeTruthy();
		expect(region("AI usage").getByText(/Scored CVs, rewritten descriptions and interview questions show here/)).toBeTruthy();
		expect(region("Recent activity").getByText(/Nothing has happened yet/)).toBeTruthy();
	});

	it("loads every card on its own, and one card failing leaves the others standing", async () => {
		failing = new Set(["velocity"]);
		renderOverview();
		const pipeline = within(await screen.findByRole("region", { name: "Pipeline" }, { timeout: 4000 }));
		const alert = await pipeline.findByRole("alert");
		expect(alert.textContent).toContain("We couldn't load pipeline velocity.");
		expect(alert.textContent).toContain("Something went wrong on our side. Try again.");
		// The funnel shares the card but has its own request.
		expect(await pipeline.findByText(/88% of received/)).toBeTruthy();

		expect(await within(await screen.findByRole("region", { name: "Key numbers" })).findByText("120")).toBeTruthy();
		expect(await within(screen.getByRole("region", { name: "AI usage" })).findByText("CV scoring")).toBeTruthy();
		expect(await within(screen.getByRole("region", { name: "Recent activity" })).findByText("5 min ago")).toBeTruthy();
		expect(await within(screen.getByRole("region", { name: "Waiting for you" })).findAllByRole("article")).toHaveLength(3);
		expect(screen.getAllByRole("alert")).toHaveLength(1);

		failing = new Set();
		fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
		expect(await pipeline.findByRole("img", { name: /CVs uploaded per day/ })).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		// The work queue is asked once, though the sidebar's to-review badge reads it too.
		expect(calls).toEqual({ attention: 1, kpis: 1, velocity: 2, funnel: 1, "ai-mix": 1, activity: 1 });
	});

	it("shows a loading state in the card that is still waiting, while the others fill in", async () => {
		stalled = new Set(["activity"]);
		renderOverview();
		const activity = within(await screen.findByRole("region", { name: "Recent activity" }, { timeout: 4000 }));
		expect(activity.getByText("Loading recent activity")).toBeTruthy();
		expect(await within(screen.getByRole("region", { name: "Key numbers" })).findByText("120")).toBeTruthy();
		expect(screen.queryByText("Loading your key numbers")).toBeNull();
	});

	it("says what went wrong with the work queue, and leaves out what depends on it", async () => {
		failing = new Set(["attention"]);
		renderOverview();
		const waiting = within(await screen.findByRole("region", { name: "Waiting for you" }, { timeout: 4000 }));
		const alert = await waiting.findByRole("alert");
		expect(alert.textContent).toContain("We couldn't load your work queue.");
		expect(summary()).toBeNull();
		expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
		expect(screen.queryByRole("region", { name: "Best new matches" })).toBeNull();
		expect(await within(screen.getByRole("region", { name: "Key numbers" })).findByText("120")).toBeTruthy();
	});

	it("says what went wrong in each card when everything fails", async () => {
		failing = new Set(["attention", "kpis", "velocity", "funnel", "ai-mix", "activity"]);
		renderOverview();
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
		await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(6));
		expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(6);
		expect(screen.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
	});
});
