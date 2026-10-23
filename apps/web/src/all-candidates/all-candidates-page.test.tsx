import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllCandidate, AllCandidatesCounts, AllCandidatesList } from "../lib/all-candidates.ts";
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

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const row = (over: Partial<AllCandidate> & Pick<AllCandidate, "id" | "name">): AllCandidate => ({
	jobId: "job_1",
	jobTitle: "Staff Engineer",
	fileName: `${over.id}.pdf`,
	headline: null,
	email: null,
	score: null,
	status: "scored",
	decision: "undecided",
	source: "upload",
	hasNote: false,
	createdAt: minutesAgo(120),
	scoredAt: minutesAgo(100),
	...over,
});

const everyone: AllCandidate[] = [
	row({ id: "c1", name: "Ada Lovelace", headline: "Staff Engineer · London", score: 94, decision: "shortlisted", hasNote: true, source: "apply" }),
	row({ id: "c2", name: "Grace Hopper", headline: "Principal Engineer · New York", score: 81 }),
	row({ id: "c3", name: "Alan Turing", jobId: "job_2", jobTitle: "iOS Developer", score: 62 }),
	row({ id: "c4", name: null, fileName: "kenji_cv.pdf", jobId: "job_2", jobTitle: "iOS Developer", status: "failed", scoredAt: null }),
	row({ id: "c5", name: "Lucas Becker", jobId: "job_2", jobTitle: "iOS Developer", score: 40, decision: "rejected" }),
];

const job = (id: string, title: string) => ({
	id,
	slug: `${id}-slug`,
	title,
	status: "open",
	cvCount: 3,
	hasCover: false,
	createdAt: minutesAgo(600),
	updatedAt: minutesAgo(600),
	scoredCount: 3,
	toReviewCount: 1,
	shortlistedCount: 1,
	rejectedCount: 0,
	readingCount: 0,
	failedCount: 0,
	topScore: null,
	topCandidate: null,
	lastCvAt: null,
});
const jobs = [job("job_1", "Staff Engineer"), job("job_2", "iOS Developer")];

let candidates: AllCandidate[];
// Stands in for GET /candidates when a test needs a particular answer (a long list, an error).
let listReply: ((params: URLSearchParams) => Response) | undefined;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

// GET /candidates as the API answers it: every filter applied, and each decision counted under the other filters.
function answerList(params: URLSearchParams): AllCandidatesList {
	const q = params.get("q")?.toLowerCase();
	const minScore = Number(params.get("minScore") ?? 0);
	const status = params.get("status");
	const narrowed = candidates.filter(
		(candidate) =>
			(!q || (candidate.name ?? candidate.fileName).toLowerCase().includes(q)) &&
			(!params.get("jobId") || candidate.jobId === params.get("jobId")) &&
			(!minScore || (candidate.score ?? 0) >= minScore) &&
			(!status || (status === "reading" ? ["queued", "scoring"].includes(candidate.status) : candidate.status === status)),
	);
	const counts: AllCandidatesCounts = {
		all: narrowed.length,
		review: narrowed.filter((candidate) => candidate.status === "scored" && candidate.decision === "undecided").length,
		shortlisted: narrowed.filter((candidate) => candidate.decision === "shortlisted").length,
		rejected: narrowed.filter((candidate) => candidate.decision === "rejected").length,
		undecided: narrowed.filter((candidate) => candidate.decision === "undecided").length,
	};
	const decision = params.get("decision");
	const shown = narrowed.filter((candidate) =>
		!decision ? true : decision === "review" ? candidate.status === "scored" && candidate.decision === "undecided" : candidate.decision === decision,
	);
	return { candidates: shown, total: shown.length, page: 1, pageSize: 50, counts };
}

beforeEach(() => {
	candidates = everyone.map((candidate) => ({ ...candidate }));
	listReply = undefined;
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const { pathname: path, searchParams } = new URL(url);
		const method = init?.method ?? "GET";
		if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role: "admin" } });
		if (path === "/jobs") return Response.json({ jobs, total: jobs.length, page: 1, pageSize: 20, counts: { all: 9, open: 2, draft: 1, closed: 6 } });
		if (path === "/candidates" && method === "GET") return listReply ? listReply(searchParams) : Response.json(answerList(searchParams));
		if (path === "/candidates/decisions" && method === "POST") {
			const body = JSON.parse(String(init?.body)) as { ids: string[]; decision: AllCandidate["decision"] };
			const updated = candidates
				.filter((candidate) => body.ids.includes(candidate.id) && candidate.decision !== body.decision)
				.map((candidate) => {
					const previous = candidate.decision;
					candidate.decision = body.decision;
					return { id: candidate.id, jobId: candidate.jobId, decision: body.decision, previous };
				});
			return Response.json({ updated });
		}
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderPage(path = "/dashboard/candidates") {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

const main = () => within(screen.getByRole("main"));
// Navigating and refetching can take a while when the whole suite runs at once.
const settle = { timeout: 3000 };
// The line under the h1.
const summary = () => screen.getByRole("heading", { level: 1, name: "Candidates" }).nextElementSibling?.textContent;
const listAsked = () =>
	fetchMock.mock.calls
		.map(([url, init]) => ({ url: new URL(url), method: init?.method ?? "GET" }))
		.filter(({ url, method }) => url.pathname === "/candidates" && method === "GET")
		.map(({ url }) => url.search);
const loaded = async () => {
	// The first test also loads the page's code, which can be slow on a busy machine.
	await screen.findByRole("heading", { level: 1, name: "Candidates" }, { timeout: 5000 });
	await screen.findByRole("table", { name: "Candidates across your jobs" }, { timeout: 5000 });
};
const pickFrom = async (trigger: string, item: string) => {
	fireEvent.click(main().getByRole("button", { name: trigger }));
	fireEvent.click(await screen.findByRole("menuitemradio", { name: item }));
};

describe("the candidates page", () => {
	it("lists every candidate across the jobs, with the summary, counts and links", { timeout: 15_000 }, async () => {
		renderPage();
		await loaded();
		expect(summary()).toBe("5 candidates across 9 jobs · 2 to review");
		expect(main().getByRole("status", { name: "" }).textContent).toBe("Showing 1–5 of 5");
		expect(main().getByRole("radio", { name: "All 5" })).toHaveProperty("checked", true);
		expect(main().getByRole("radio", { name: "To review 2" })).toBeTruthy();
		expect(main().getByRole("radio", { name: "Not a fit 1" })).toBeTruthy();
		// Nothing narrows the list, so there is nothing to clear.
		expect(main().queryByRole("button", { name: "Clear filters" })).toBeNull();

		const table = within(main().getByRole("table", { name: "Candidates across your jobs" }));
		const rows = table.getAllByRole("row").slice(1);
		expect(rows).toHaveLength(5);
		const ada = within(rows[0]);
		// It says it came from this list, so the candidate page links back here.
		expect(ada.getByRole("link", { name: /Ada Lovelace/ }).getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/c1?from=candidates");
		expect(ada.getByText("Has a note")).toBeTruthy();
		expect(ada.getByRole("link", { name: "Staff Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
		expect(ada.getByText("94")).toBeTruthy();
		expect(ada.getByText("Shortlisted")).toBeTruthy();
		expect(ada.getByText(/^Applied /)).toBeTruthy();
		// Scored and undecided reads "To review"; a CV that couldn't be read has its file name and no score.
		expect(within(rows[1]).getByText("To review")).toBeTruthy();
		expect(within(rows[3]).getByRole("link", { name: /kenji_cv\.pdf/ })).toBeTruthy();
		expect(within(rows[3]).getByText("No score yet")).toBeTruthy();
		expect(within(rows[3]).getByText(/Couldn't read/)).toBeTruthy();
		expect(within(rows[4]).getByText("Not a fit")).toBeTruthy();
	});

	it("shows the filters a link asks for and asks the API for them", { timeout: 10_000 }, async () => {
		renderPage("/dashboard/candidates?jobId=job_1&decision=review&status=scored&minScore=70&sort=newest");
		await loaded();
		expect(listAsked()[0]).toBe("?jobId=job_1&decision=review&status=scored&minScore=70&sort=newest");
		expect(summary()).toBe("2 candidates match your filters · 1 to review");
		expect(main().getByRole("radio", { name: "To review 1" })).toHaveProperty("checked", true);
		expect(main().getByRole("button", { name: "Job: Staff Engineer" })).toBeTruthy();
		expect(main().getByRole("button", { name: "Status: Scored" })).toBeTruthy();
		expect(main().getByRole("button", { name: "Minimum score: Score 70+" })).toBeTruthy();
		expect(main().getByRole("button", { name: "Sort: Newest" })).toBeTruthy();
		expect(main().getByRole("button", { name: "Clear filters" })).toBeTruthy();
		const rows = within(main().getByRole("table")).getAllByRole("row").slice(1);
		expect(rows.map((tr) => within(tr).getAllByRole("link")[0].textContent)).toEqual(["Grace Hopper"]);
	});

	it("drops what it can't read from a link and shows the plain list", { timeout: 10_000 }, async () => {
		renderPage("/dashboard/candidates?decision=maybe&minScore=12&sort=random&page=-3");
		await loaded();
		expect(listAsked()[0]).toBe("");
		expect(main().getByRole("radio", { name: "All 5" })).toHaveProperty("checked", true);
		expect(main().getByRole("button", { name: "Minimum score: Any score" })).toBeTruthy();
	});

	it("puts every filter in the address and Clear filters takes them all out", { timeout: 15_000 }, async () => {
		const router = renderPage();
		await loaded();

		fireEvent.click(main().getByRole("radio", { name: "Shortlisted 1" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ decision: "shortlisted" }), settle);
		await waitFor(() => expect(listAsked()).toContain("?decision=shortlisted"), settle);

		await pickFrom("Status: Any status", "Scored");
		await waitFor(() => expect(router.state.location.search).toEqual({ decision: "shortlisted", status: "scored" }), settle);
		await pickFrom("Minimum score: Any score", "Score 85+");
		await waitFor(() => expect(router.state.location.search).toMatchObject({ minScore: 85 }), settle);
		await pickFrom("Sort: Best match", "Name");
		await waitFor(() => expect(router.state.location.search).toMatchObject({ sort: "name" }), settle);

		// Typing waits a moment, then searches in place of the last address rather than adding one per letter.
		fireEvent.change(main().getByRole("searchbox", { name: "Search candidates" }), { target: { value: "  ada  " } });
		await waitFor(() => expect(router.state.location.search).toMatchObject({ q: "ada" }), settle);
		expect(summary()).toBe("1 candidate matches your filters");

		fireEvent.click(main().getByRole("button", { name: "Clear filters" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ sort: "name" }), settle);
		expect((main().getByRole("searchbox", { name: "Search candidates" }) as HTMLInputElement).value).toBe("");
		await waitFor(() => expect(summary()).toBe("5 candidates across 9 jobs · 2 to review"), settle);
		// Clear filters goes once nothing is filtered, so focus moves to the decision filter.
		expect(document.activeElement).toBe(main().getByRole("radio", { name: "All 5" }));
	});

	it("filters by job from the Job picker, searching the jobs as you type", { timeout: 10_000 }, async () => {
		const router = renderPage();
		await loaded();
		fireEvent.click(main().getByRole("button", { name: "Job: All jobs" }));
		const dialog = within(await screen.findByRole("dialog", { name: "Filter by job" }));
		const options = within(dialog.getByRole("listbox", { name: "Jobs" }));
		expect(options.getAllByRole("option").map((option) => option.textContent)).toEqual([
			expect.stringContaining("All jobs"),
			expect.stringContaining("Staff Engineer"),
			expect.stringContaining("iOS Developer"),
		]);
		fireEvent.click(options.getByRole("option", { name: /iOS Developer/ }));
		await waitFor(() => expect(router.state.location.search).toEqual({ jobId: "job_2" }), settle);
		expect(await main().findByRole("button", { name: "Job: iOS Developer" })).toBeTruthy();
		await waitFor(() => expect(summary()).toBe("3 candidates match your filters · 1 to review"), settle);
	});

	it("checks rows into the bulk bar and shortlists them across jobs", { timeout: 10_000 }, async () => {
		renderPage();
		await loaded();
		expect(screen.queryByRole("region", { name: "Selected candidates" })).toBeNull();

		fireEvent.click(main().getByRole("checkbox", { name: "Select Grace Hopper" }));
		fireEvent.click(main().getByRole("checkbox", { name: "Select Alan Turing" }));
		const bar = within(screen.getByRole("region", { name: "Selected candidates" }));
		expect(bar.getByRole("status").textContent).toBe("2 selected");
		// Admins can delete; there is no single job to export here.
		expect(bar.getByRole("button", { name: /Delete/ })).toBeTruthy();
		expect(bar.queryByRole("button", { name: /Export/ })).toBeNull();
		const selectAll = main().getByRole("checkbox", { name: "Select all 5 candidates on this page" }) as HTMLInputElement;
		expect(selectAll.indeterminate).toBe(true);

		fireEvent.click(bar.getByRole("button", { name: "Shortlist" }));
		await screen.findByText("Shortlisted 2 candidates", {}, settle);
		const sent = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === "/candidates/decisions");
		expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ ids: ["c2", "c3"], decision: "shortlisted" });
		// The bar hands over to the toast, and the list asks again for the new decisions.
		expect(screen.queryByRole("region", { name: "Selected candidates" })).toBeNull();
		await waitFor(() => expect(main().getByRole("radio", { name: "Shortlisted 3" })).toBeTruthy(), settle);
	});

	it("selects the whole page from the header and Escape clears it", { timeout: 10_000 }, async () => {
		renderPage();
		await loaded();
		fireEvent.click(main().getByRole("checkbox", { name: "Select all 5 candidates on this page" }));
		expect(within(screen.getByRole("region", { name: "Selected candidates" })).getByRole("status").textContent).toBe("5 selected");
		expect(main().getByRole("checkbox", { name: "Unselect all 5 candidates on this page" })).toBeTruthy();

		fireEvent.keyDown(document.body, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("region", { name: "Selected candidates" })).toBeNull(), settle);
		expect(main().getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
	});

	it("pages through a long list from the server", { timeout: 10_000 }, async () => {
		const many = Array.from({ length: 50 }, (_, index) => row({ id: `p${index}`, name: `Person ${index}`, score: 60 }));
		const counts = { all: 120, review: 120, shortlisted: 0, rejected: 0, undecided: 120 };
		listReply = (params) => {
			const page = Number(params.get("page") ?? 1);
			return Response.json({ candidates: page === 3 ? many.slice(0, 20) : many, total: 120, page, pageSize: 50, counts });
		};
		const router = renderPage();
		await loaded();
		expect(main().getByText("Showing 1–50 of 120")).toBeTruthy();
		const pages = within(main().getByRole("navigation", { name: "Pages" }));
		expect(pages.getByText("Page 1 of 3")).toBeTruthy();
		expect(pages.getByRole("button", { name: "Previous" }).getAttribute("aria-disabled")).toBe("true");

		fireEvent.click(pages.getByRole("button", { name: "Next" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ page: 2 }), settle);
		await waitFor(() => expect(main().getByText("Showing 51–100 of 120")).toBeTruthy(), settle);
		fireEvent.click(pages.getByRole("button", { name: "Next" }));
		await waitFor(() => expect(main().getByText("Showing 101–120 of 120")).toBeTruthy(), settle);
		expect(pages.getByRole("button", { name: "Next" }).getAttribute("aria-disabled")).toBe("true");

		// A filter goes back to the first page.
		fireEvent.click(main().getByRole("radio", { name: "To review 120" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ decision: "review" }), settle);
	});
});

describe("when nothing is listed", () => {
	it("points a company with no candidates at its jobs", { timeout: 10_000 }, async () => {
		candidates = [];
		renderPage();
		expect(await screen.findByRole("heading", { name: "No candidates yet" }, { timeout: 5000 })).toBeTruthy();
		expect(summary()).toBe("No candidates yet");
		expect(main().getByRole("link", { name: /Go to your jobs/ }).getAttribute("href")).toBe("/dashboard/jobs");
		expect(main().getByRole("link", { name: "Post a job" }).getAttribute("href")).toBe("/dashboard/jobs/new");
		// No toolbar: there is nothing to filter.
		expect(main().queryByRole("search")).toBeNull();
	});

	it("offers to clear filters that match no one", { timeout: 10_000 }, async () => {
		const router = renderPage("/dashboard/candidates?q=nobody&minScore=50");
		expect(await screen.findByRole("heading", { name: "No candidates match" }, { timeout: 5000 })).toBeTruthy();
		expect(summary()).toBe("0 candidates match your filters");
		const clear = main().getAllByRole("button", { name: "Clear filters" });
		// One in the toolbar, one in the empty state.
		expect(clear).toHaveLength(2);
		fireEvent.click(clear[1]);
		await waitFor(() => expect(router.state.location.search).toEqual({}), settle);
		await screen.findByRole("table", { name: "Candidates across your jobs" });
	});

	it("says plainly when a decision has no one in it", { timeout: 10_000 }, async () => {
		candidates = candidates.filter((candidate) => candidate.decision !== "shortlisted");
		const router = renderPage("/dashboard/candidates?decision=shortlisted");
		expect(await screen.findByRole("heading", { name: "No one is shortlisted yet" }, { timeout: 5000 })).toBeTruthy();
		fireEvent.click(main().getByRole("button", { name: "Show all candidates" }));
		await waitFor(() => expect(router.state.location.search).toEqual({}), settle);
	});

	it("says when the list couldn't load and tries again", { timeout: 10_000 }, async () => {
		let failing = true;
		listReply = (params) =>
			failing
				? Response.json({ error: { code: "internal_error", message: "Something went wrong on our side. Try again." } }, { status: 500 })
				: Response.json(answerList(params));
		renderPage();
		const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
		expect(alert.textContent).toContain("We couldn't load your candidates");
		failing = false;
		fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
		await loaded();
	});
});
