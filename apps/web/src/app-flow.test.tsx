import { type RubricItem, type Weight, gapLabels, matchLabels, scoreChecks, visibleItems } from "@lucid-hire/scoring";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserHistory, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, configure, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { type Mock, type MockInstance, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CANDIDATE_POLL_MS,
	CV_MAX_BYTES,
	CV_URL_REVOKE_MS,
	type Candidate,
	type Decision,
	useDecideCandidate,
} from "./lib/candidates.ts";
import type { RubricStatus } from "./lib/rubric.ts";
import { createAppRouter } from "./router.ts";
import { stubXhr } from "./test/fake-xhr.ts";

// Pages load code-split chunks, which can take a while when several test runs share a machine.
configure({ asyncUtilTimeout: 5000 });

// Clerk is replaced by a session we control; the API by an in-memory fake of /me, /orgs, /jobs and the
// candidates under each job.
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@clerk/react", () => ({
	useAuth: () => ({
		isLoaded: true,
		isSignedIn: session.signedIn,
		userId: session.signedIn ? "user_1" : null,
		getToken: async () => (session.signedIn ? "session-token" : null),
	}),
	// The dashboard's account menu reads the name and email; without a user it shows "Your account".
	useUser: () => ({ isLoaded: true, user: null }),
	RedirectToSignIn: ({ redirectUrl }: { redirectUrl?: string }) => <p data-redirect-url={redirectUrl}>Redirecting to sign in</p>,
	UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
	UserProfile: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
	ClerkLoading: () => null,
	ClerkFailed: () => null,
}));

type Org = { id: string; name: string; role: "admin" | "member" };
type FakeJob = {
	id: string;
	title: string;
	description: string;
	status: string;
	cvCount?: number;
	hasCover?: boolean;
	createdAt: string;
	updatedAt: string;
	rubric?: RubricItem[] | null;
	rubricStatus?: RubricStatus;
};
type FakeCandidate = Candidate & { jobId: string };
let org: Org | null;
let jobs: FakeJob[];
let candidates: FakeCandidate[];
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
// The percentages the fake upload reports before the server answers.
let uploadProgress: number[];
// What GET /billing answers, and the CV limit the candidates list reports (Free: 10 per job).
let jobsUsed = 0;
let jobsLimit: number | null = 10;
let cvLimit = 10;
// The company's people, as GET /team lists them.
let teamMembers: { userId: string; role: string; name: string | null; email: string | null; imageUrl: string | null; joinedAt: string; isYou: boolean }[] = [];

const notFound = () => Response.json({ error: { message: "That job doesn't exist or isn't yours" } }, { status: 404 });
const apiError = (status: number, code: string, message: string) =>
	Response.json({ error: { code, message } }, { status });
// What the API sends for a job: the CV count and the requirements' state are always there.
const withCount = (job: FakeJob) => ({
	...job,
	slug: `${job.id}-slug`,
	hasCover: job.hasCover ?? false,
	cvCount: job.cvCount ?? 0,
	rubric: job.rubric ?? null,
	rubricStatus: job.rubricStatus ?? "none",
});
// What the requirements endpoints answer next, when a test wants them to refuse.
let rubricRefusal: Response | null = null;

// What the API does to a job's CVs when its requirements change: each CV's evidence follows the requirements (by id,
// a new one not checked), and its score, matches and gaps are worked out again with the shared formula. CVs scored
// before the job had requirements keep theirs.
function rescoreJob(job: FakeJob) {
	for (const candidate of candidates) {
		if (candidate.jobId !== job.id || !candidate.evidence || candidate.scoredBeforeRequirements) continue;
		const found = new Map(candidate.evidence.map((entry) => [entry.id, entry]));
		candidate.evidence = visibleItems(job.rubric ?? []).map(({ id, label, detail, weight }) => ({
			id,
			label,
			detail,
			weight,
			level: found.get(id)?.level ?? null,
			quote: found.get(id)?.quote ?? "",
		}));
		const checks = candidate.evidence.map(({ id, label, weight, level }) => ({ id, label, weight, level }));
		Object.assign(candidate, { score: scoreChecks(checks), matches: matchLabels(checks), gaps: gapLabels(checks) });
	}
}

// The requirements endpoints (PATCH /jobs/:id/rubric and the three POSTs), enough of them for the Requirements tab.
function fakeRubric(job: FakeJob, path: string, method: string, body: unknown): Response | null {
	if (!path.includes("/rubric")) return null;
	if (rubricRefusal) return rubricRefusal.clone();
	if (path.endsWith("/rubric/draft") && method === "POST") {
		if (job.rubricStatus === "drafting") return apiError(409, "rubric_drafting", "The requirements are already being drafted.");
		job.rubricStatus = "drafting";
		return Response.json({ job: withCount(job) }, { status: 202 });
	}
	if (job.rubricStatus !== "ready" || !job.rubric) return apiError(409, "rubric_not_ready", "The requirements aren't ready.");
	if (path.endsWith("/rubric") && method === "PATCH") {
		const { changes } = body as { changes: { id: string; weight?: Weight; label?: string; removed?: true }[] };
		job.rubric = job.rubric.map((item) => {
			const change = changes.find(({ id }) => id === item.id);
			if (!change) return item;
			return {
				...item,
				...(change.weight && { weight: change.weight }),
				...(change.label !== undefined && { label: change.label.trim() }),
				...(change.removed && { removed: true as const }),
			};
		});
		rescoreJob(job);
		return Response.json({ job: withCount(job) });
	}
	if (path.endsWith("/rubric/requirements") && method === "POST") {
		const { label, detail, weight } = body as { label: string; detail: string; weight: Weight };
		const item = { id: `r${job.rubric.length + 1}`, label, detail, weight };
		job.rubric = [...job.rubric, item];
		rescoreJob(job);
		return Response.json({ job: withCount(job), item }, { status: 201 });
	}
	if (path.endsWith("/rubric/check") && method === "POST") {
		const due = candidates.filter(
			(c) =>
				c.jobId === job.id &&
				c.status === "scored" &&
				!c.scoredBeforeRequirements &&
				(c.evidence ?? []).some(({ level }) => level === null),
		);
		for (const candidate of due) candidate.checking = true;
		return Response.json({ started: due.length }, { status: 202 });
	}
	return null;
}

// The jobs API, enough of it for the pages: list, create, read, edit, delete and the AI rewrite.
function fakeJobs(path: string, method: string, body: Record<string, string>, query = new URLSearchParams()): Response {
	const id = path.split("/")[2];
	const job = jobs.find((candidate) => candidate.id === id);
	if (path === "/jobs" && method === "GET") {
		const q = (query.get("q") ?? "").toLowerCase();
		const status = query.get("status");
		const sort = query.get("sort") ?? "newest";
		const page = Number(query.get("page") ?? 1);
		// Each job's pipeline as the API counts it (apps/api/src/pipeline.ts), with its best scored CV and latest upload.
		const pipeline = (jobId: string) => {
			const cvs = candidates.filter((c) => c.jobId === jobId);
			const count = (test: (c: FakeCandidate) => boolean) => cvs.filter(test).length;
			const top = cvs
				.filter((c) => c.status === "scored" && c.score !== null)
				.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
			return {
				scoredCount: count((c) => c.status === "scored"),
				toReviewCount: count((c) => c.status === "scored" && c.decision === "undecided"),
				shortlistedCount: count((c) => c.decision === "shortlisted"),
				rejectedCount: count((c) => c.decision === "rejected"),
				readingCount: count((c) => c.status === "queued" || c.status === "scoring"),
				failedCount: count((c) => c.status === "failed"),
				topScore: top?.score ?? null,
				topCandidate: top ? { id: top.id, name: top.name } : null,
				lastCvAt: cvs.map((c) => c.createdAt).toSorted().at(-1) ?? null,
			};
		};
		const newest = (a: FakeJob, b: FakeJob) => b.createdAt.localeCompare(a.createdAt);
		// The per-status counts follow the search but not the status filter.
		const searched = jobs.filter((j) => !q || `${j.title} ${j.description}`.toLowerCase().includes(q));
		const matching = searched
			.filter((j) => !status || j.status === status)
			.map((j) => ({ job: j, pipeline: pipeline(j.id) }))
			.toSorted((a, b) =>
				sort === "oldest"
					? a.job.createdAt.localeCompare(b.job.createdAt)
					: sort === "title"
						? a.job.title.localeCompare(b.job.title)
						: sort === "candidates"
							? (b.job.cvCount ?? 0) - (a.job.cvCount ?? 0)
							: sort === "review"
								? b.pipeline.toReviewCount - a.pipeline.toReviewCount || newest(a.job, b.job)
								: sort === "activity"
									? (b.pipeline.lastCvAt ?? "").localeCompare(a.pipeline.lastCvAt ?? "") || newest(a.job, b.job)
									: newest(a.job, b.job),
			);
		const counted = (value: string) => searched.filter((j) => j.status === value).length;
		return Response.json({
			jobs: matching.slice((page - 1) * 20, page * 20).map(({ job: { id, title, status, cvCount, createdAt, updatedAt }, pipeline }) => ({
				slug: `${id}-slug`,
				id,
				title,
				status,
				cvCount: cvCount ?? 0,
				...pipeline,
				createdAt,
				updatedAt,
			})),
			total: matching.length,
			page,
			pageSize: 20,
			counts: { all: searched.length, open: counted("open"), draft: counted("draft"), closed: counted("closed") },
		});
	}
	if (path === "/jobs" && method === "POST") {
		const now = new Date("2026-10-22T12:00:00Z").toISOString();
		const created = {
			id: `job_${jobs.length + 1}`,
			createdAt: now,
			updatedAt: now,
			status: "draft",
			...body,
		} as FakeJob;
		jobs.unshift(created);
		return Response.json({ job: withCount(created) }, { status: 201 });
	}
	if (path.endsWith("/duplicate") && method === "POST" && job) {
		const now = new Date("2026-10-22T14:00:00Z").toISOString();
		const copy = {
			...job,
			id: `job_${jobs.length + 1}`,
			title: `${job.title} (copy)`,
			status: "draft",
			cvCount: 0,
			createdAt: now,
			updatedAt: now,
		};
		jobs.unshift(copy);
		return Response.json({ job: withCount(copy) }, { status: 201 });
	}
	if (path === "/jobs/enhance") {
		return Response.json({ description: `What you need:\n- ${body.description}` });
	}
	if (!job) return notFound();
	const rubricAnswer = fakeRubric(job, path, method, body);
	if (rubricAnswer) return rubricAnswer;
	if (path.endsWith("/cover")) {
		if (method === "GET") return new Response(new Blob(["png"], { type: "image/png" }));
		job.hasCover = method === "PUT";
		return Response.json({ job: withCount(job) });
	}
	if (method === "GET") return Response.json({ job: withCount(job) });
	if (method === "PATCH") {
		Object.assign(job, body, { updatedAt: new Date("2026-10-23T09:00:00Z").toISOString() });
		return Response.json({ job: withCount(job) });
	}
	if (method === "DELETE") {
		jobs = jobs.filter((candidate) => candidate !== job);
		return new Response(null, { status: 204 });
	}
	return notFound();
}

// A candidate as the list shows it, without the fields only the candidate page needs. Its checks come from its evidence.
const summary = ({
	jobId: _jobId,
	rankedCount: _rankedCount,
	evidence,
	legacyRequirements: _legacy,
	fileSize: _size,
	note,
	decidedAt: _decidedAt,
	profile,
	decidedBy: _decidedBy,
	...rest
}: FakeCandidate) => ({
	...rest,
	hasNote: note !== null,
	profile: profile?.email ? { email: profile.email } : null,
	checks: (evidence ?? []).map(({ id, label, weight, level }) => ({ id, label, weight, level })),
});
// The page also gets the place among the job's scored CVs, ordered by score as the list is.
const forPage = ({ jobId, ...rest }: FakeCandidate): Candidate => {
	const scored = candidates
		.filter((c) => c.jobId === jobId && c.status === "scored" && c.score !== null)
		.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0));
	const index = scored.findIndex((c) => c.id === rest.id);
	return index === -1 ? rest : { ...rest, rank: index + 1, rankedCount: scored.length };
};
// Scored first (best first), then the ones being read, then the failed, as the API orders them.
const place = (candidate: FakeCandidate) => ({ scored: 0, queued: 1, scoring: 1, failed: 2 })[candidate.status];

// The candidates API: the ranked list, upload (the raw PDF as the body), read, decide, the CV file, retry and
// admin-only delete.
function fakeCandidates(url: URL, init: RequestInit | undefined): Response {
	const [, , jobId, , id, action] = url.pathname.split("/");
	const method = init?.method ?? "GET";
	const job = jobs.find((candidate) => candidate.id === jobId);
	if (!job) return notFound();

	if (id === "export.csv") {
		const decision = url.searchParams.get("decision");
		return new Response(`\uFEFFRank,Name\r\n1,Grace (${decision})\r\n`, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="senior-ios-engineer-${decision === "all" ? "" : `${decision}-`}applicants.csv"`,
			},
		});
	}
	if (!id) {
		if (method === "GET") {
			const ranked = candidates
				.filter((candidate) => candidate.jobId === jobId)
				.toSorted(
					(a, b) =>
						place(a) - place(b) ||
						(a.status === "scored" ? (b.score ?? 0) - (a.score ?? 0) : a.createdAt.localeCompare(b.createdAt)),
				);
			let rank = 0;
			const withRanks = ranked.map((candidate) => ({
				...candidate,
				rank: candidate.status === "scored" && candidate.score !== null ? ++rank : null,
			}));
			return Response.json({ candidates: withRanks.map(summary), cvCount: job.cvCount ?? 0, cvLimit });
		}
		const fileName = url.searchParams.get("fileName") ?? "cv.pdf";
		if (new Headers(init?.headers).get("Content-Type") !== "application/pdf" || !fileName.endsWith(".pdf"))
			return apiError(415, "not_pdf", "Upload a PDF file");
		if (job.status !== "open")
			return apiError(409, "job_not_open", "This job isn't open, so it can't take CVs. Open it first.");
		if ((job.cvCount ?? 0) >= 10) return apiError(403, "cv_limit", "This job has used its 10 free CVs");
		job.cvCount = (job.cvCount ?? 0) + 1;
		const created = fakeCandidate({
			id: `cand_${candidates.length + 1}`,
			jobId,
			fileName,
			status: "queued",
			fileSize: (init!.body as File).size,
			createdAt: new Date(Date.UTC(2026, 9, 22, 13, 0, candidates.length)).toISOString(),
		});
		candidates.push(created);
		return Response.json({ candidate: forPage(created) }, { status: 201 });
	}

	const found = candidates.find((candidate) => candidate.id === id && candidate.jobId === jobId);
	if (!found) return apiError(404, "candidate_not_found", "That candidate doesn't exist or isn't yours");
	if (action === "retry") {
		// A CV that failed can be retried while it has runs left; so can one stuck in the queue, and one scored before
		// the job had requirements (to read it against them).
		if (found.status === "scored" && !found.scoredBeforeRequirements)
			return apiError(409, "not_failed", "Only a CV that failed can be retried");
		if (!found.canRetry) {
			return found.status === "failed"
				? apiError(409, "retry_limit", "We've tried this CV 3 times. It may not be a readable PDF.")
				: apiError(409, "not_failed", "Only a CV that failed can be retried");
		}
		Object.assign(found, { status: "queued", error: null, canRetry: false, updatedAt: new Date().toISOString() });
		return Response.json({ candidate: forPage(found) }, { status: 202 });
	}
	if (action === "cv") {
		return new Response("%PDF-1.4 fake", { headers: { "Content-Type": "application/pdf" } });
	}
	if (method === "PATCH") {
		const patch = JSON.parse(init!.body as string) as { decision?: Decision; note?: string | null };
		if (patch.decision !== undefined && patch.decision !== found.decision) {
			found.decidedAt = patch.decision === "undecided" ? null : new Date().toISOString();
			found.decidedBy = patch.decision === "undecided" ? null : "user_1";
		}
		if (patch.decision !== undefined) found.decision = patch.decision;
		if (patch.note !== undefined) found.note = patch.note?.trim() || null;
		return Response.json({ candidate: forPage(found) });
	}
	if (method === "DELETE") {
		if (org?.role !== "admin") return apiError(403, "forbidden", "Only admins can delete candidates");
		candidates = candidates.filter((candidate) => candidate !== found);
		return new Response(null, { status: 204 });
	}
	return Response.json({ candidate: forPage(found) });
}

// A candidate on "job_1". Anything not given is a plain, scored CV with nothing marked yet.
function fakeCandidate(fields: Partial<FakeCandidate> & { id: string }): FakeCandidate {
	return {
		jobId: "job_1",
		fileName: `${fields.id}.pdf`,
		source: "upload",
		email: null,
		status: "scored",
		decision: "undecided",
		name: null,
		headline: null,
		score: null,
		rank: null,
		rankedCount: 0,
		matches: [],
		gaps: [],
		checks: [],
		hasNote: false,
		error: null,
		canRetry: false,
		createdAt: "2026-10-22T12:00:00Z",
		scoredAt: null,
		summary: null,
		evidence: null,
		legacyRequirements: null,
		scoredBeforeRequirements: false,
		checking: false,
		fileSize: 120_000,
		note: null,
		decidedAt: null,
		profile: null,
		decidedBy: null,
		...fields,
	};
}

// The Markdown renderer is loaded on demand; loading it once up front keeps the first test from racing the import.
beforeAll(() => import("./components/markdown.tsx"), 60_000);

beforeEach(() => {
	session.signedIn = true;
	rubricRefusal = null;
	jobsUsed = 0;
	jobsLimit = 10;
	cvLimit = 10;
	teamMembers = [];
	org = null;
	jobs = [];
	candidates = [];
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		// Uploads send a file, not JSON.
		const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, string>) : {};
		if (path === "/me") return Response.json({ userId: "user_1", org });
		if (path === "/team") return Response.json({ members: teamMembers });
		if (path === "/billing") {
			return Response.json({
				plan: "free",
				effectivePlan: "free",
				status: null,
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				isAdmin: org?.role === "admin",
				usage: { jobsThisMonth: jobsUsed, jobsLimit, busiestJob: null, cvLimit, aiThisHour: 0, aiLimit: 30 },
			});
		}
		if (path === "/orgs" && method === "POST") {
			org = { id: "org_1", name: body.name, role: "admin" };
			return Response.json({ org }, { status: 201 });
		}
		if (/^\/jobs\/[^/]+\/candidates/.test(path)) return fakeCandidates(new URL(url), init);
		if (path.startsWith("/jobs")) return fakeJobs(path, method, body, new URL(url).searchParams);
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	// Uploads go through XMLHttpRequest, for its progress; the fake hands them to the same fake API as everything else.
	uploadProgress = [50];
	stubXhr(async (request, progress) => {
		for (const percent of uploadProgress) progress(percent, 100);
		const res = await fetchMock(request.url, { method: request.method, headers: request.headers, body: request.body });
		return { status: res.status, body: await res.text() };
	});
	// The router restores scroll on navigation; jsdom doesn't implement it.
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
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

// Holds back the answer to the requests `match` picks until `release()`. The fake server has already handled them,
// so what is released is a snapshot of the moment they were sent.
function hold(match: (url: string, init?: RequestInit) => boolean) {
	const answer = fetchMock.getMockImplementation()!;
	const held: Array<() => void> = [];
	fetchMock.mockImplementation((url: string, init?: RequestInit) => {
		const response = answer(url, init);
		return match(url, init) ? new Promise((resolve) => held.push(() => resolve(response))) : response;
	});
	return { pending: () => held.length, release: () => held.splice(0).forEach((send) => send()) };
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
		// Focus goes to the field with the problem.
		expect(document.activeElement).toBe(input);
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/orgs"), expect.anything());

		fireEvent.change(input, { target: { value: "  Sprite   Labs " } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));

		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
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

	it("shows the company name on a sample job page as it is typed, on the second sign-up step", async () => {
		renderAt("/onboarding");
		const input = await screen.findByLabelText("Company name");
		expect(screen.getByRole("list", { name: "Sign-up, step 2 of 2" })).toBeTruthy();
		expect(screen.getByRole("img", { name: /^A sample job page: your company is hiring/ })).toBeTruthy();

		fireEvent.change(input, { target: { value: "  Sprite   Labs " } });
		expect(screen.getByRole("img", { name: /^A sample job page: Sprite Labs is hiring/ })).toBeTruthy();
	});
});

describe("deep links", () => {
	it("send a signed-out visitor to sign in with the page they asked for as the way back", async () => {
		session.signedIn = false;

		renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

		const redirect = await screen.findByText("Redirecting to sign in");
		expect(redirect.getAttribute("data-redirect-url")).toBe(
			`${window.location.origin}/dashboard/jobs/job_1/candidates/cand_grace`,
		);
	});

	it("take a brand-new recruiter through onboarding and then to the page they asked for", async () => {
		jobs = [
			{
				id: "job_1",
				title: "Deep link role",
				description: "Swift, SwiftUI, 5 years.",
				status: "open",
				createdAt: "2026-10-20T09:00:00Z",
				updatedAt: "2026-10-20T09:00:00Z",
			},
		];
		const router = renderAt("/dashboard/jobs/job_1");

		const input = await screen.findByLabelText("Company name");
		expect(router.state.location.pathname).toBe("/onboarding");
expect(router.state.location.search).toEqual({ next: "/dashboard/jobs/job_1" });

		fireEvent.change(input, { target: { value: "Sprite Labs" } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));

		expect(await screen.findByRole("heading", { level: 1, name: "Deep link role" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1");
	});

	it("ignore a way back that is not a dashboard page", async () => {
		const router = renderAt("/onboarding?next=https://evil.example/");

		await screen.findByLabelText("Company name");
		expect(router.state.location.search).toEqual({});
		fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Sprite Labs" } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));

		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
	});
});

describe("returning recruiters", () => {
	it("skip onboarding and land on their dashboard", async () => {
		org = { id: "org_1", name: "Acme Hiring", role: "admin" };
		const router = renderAt("/onboarding");

		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
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
	// jsdom has no matchMedia, so the stages start finished, as they do with reduced motion.
	it("see the sample shortlist on sign-in as it ends, with the new application in second place", async () => {
		session.signedIn = false;
		renderAt("/sign-in");

		const stage = await screen.findByRole("img", { name: /^A sample shortlist for a Senior iOS Engineer job/ });
		expect(stage.getAttribute("aria-label")).toContain("Sophia Carter applied while you were away, scored 81 and moved up to second");
		expect(within(stage).getByText("Sophia Carter moves up to 2nd")).toBeTruthy();
		expect(screen.getByRole("heading", { level: 1, name: "Welcome back. Your shortlist is waiting." })).toBeTruthy();
	});
});

describe("jobs", () => {
	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
	});

	it("previews the description as Markdown on the Preview tab, and the apply page header as the title is typed", async () => {
		renderAt("/dashboard/jobs/new");
		const title = await screen.findByLabelText("Job title");
		const view = screen.getByRole("heading", { level: 2, name: "Candidate view" }).closest("section")!;
		expect(within(view).getByText("Job title")).toBeTruthy();
		expect(within(view).getByText("Open role")).toBeTruthy();
		expect(within(view).getByText("Sprite Labs")).toBeTruthy();

		fireEvent.change(title, { target: { value: "Preview role" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "## Duties\n\nShip **fast**." } });
		expect(within(view).getByText("Preview role")).toBeTruthy();
		// The header follows the status choice too.
		fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
		expect(within(view).getByText("Draft · not public")).toBeTruthy();

		const write = screen.getByRole("tab", { name: "Write" });
		const preview = screen.getByRole("tab", { name: "Preview" });
		expect(write.getAttribute("aria-selected")).toBe("true");
		fireEvent.click(preview);
		expect(preview.getAttribute("aria-selected")).toBe("true");
		expect(write.getAttribute("aria-selected")).toBe("false");
		const panel = screen.getByRole("tabpanel", { name: "Preview" });
		expect(await within(panel).findByRole("heading", { level: 2, name: "Duties" })).toBeTruthy();
		expect(within(panel).getByText("fast").tagName).toBe("STRONG");
		expect(screen.queryByLabelText("Description")).toBeNull();

		// The typed text is still there when switching back.
		fireEvent.click(write);
		expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("## Duties\n\nShip **fast**.");
		expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("Preview role");
	});

	it("says there's nothing to preview yet, and brings the description back to fix it from the Preview tab", async () => {
		renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
		expect(screen.getByText(/Nothing to preview yet/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));
		expect(await screen.findByText("✕ Describe the role: what they'll do and what they need")).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Write" }).getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(screen.getByLabelText("Description"));
	});

	it("checks the brief as it's written, in words, and never holds the save back for it", async () => {
		renderAt("/dashboard/jobs/new");
		await screen.findByLabelText("Job title");
		const check = screen.getByRole("list", { name: "Brief check" });
		// Nothing is marked missing before anything is written.
		expect(within(check).getAllByText(/Not checked yet:/)).toHaveLength(5);

		fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Platform Engineer" } });
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "## What you'll do\nRun our clusters.\n\n## Must have\n- Kubernetes\n\nRemote in Europe." },
		});
		await waitFor(() => expect(within(check).getAllByText(/Done:/)).toHaveLength(3));
		expect(within(check).getAllByText(/Missing:/).map((label) => label.nextSibling?.textContent)).toEqual([
			"Mentions nice-to-haves",
			"At least 400 characters",
		]);
		expect(within(check).getByText(/more characters to go/)).toBeTruthy();
		expect(screen.getByText("3 of 5")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));
		expect(await screen.findByRole("heading", { level: 1, name: "Platform Engineer" })).toBeTruthy();
	});

	it("adds, replaces and removes a cover image on the edit page", async () => {
		jobs = [{ id: "job_1", title: "Cover role", description: "Text", status: "open", createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z" }];
		Object.assign(URL, { createObjectURL: () => "blob:cover-1", revokeObjectURL: () => {} });
		renderAt("/dashboard/jobs/job_1/edit");
		expect(await screen.findByRole("heading", { level: 2, name: "Cover image" })).toBeTruthy();
		const input = document.querySelector('input[accept^="image/"]') as HTMLInputElement;
		expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();

		fireEvent.change(input, { target: { files: [new File(["x"], "cover.gif", { type: "image/gif" })] } });
		expect((await screen.findByRole("alert")).textContent).toContain("Upload a JPEG, PNG or WebP image");
		fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })] } });
		expect((await screen.findByRole("alert")).textContent).toContain("The cover image must be 2 MB or smaller");

		const png = new File(["x"], "cover.png", { type: "image/png" });
		fireEvent.change(input, { target: { files: [png] } });
		expect(await screen.findByText("Cover image saved")).toBeTruthy();
		const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
		expect(put[0]).toMatch(/\/jobs\/job_1\/cover$/);
		expect(put[1]?.body).toBe(png);
		expect(new Headers(put[1]?.headers).get("Content-Type")).toBe("image/png");
		expect(await screen.findByRole("img", { name: "Current cover" })).toBeTruthy();
		expect(screen.getByText("Replace image")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		expect(await screen.findByText("Cover image removed")).toBeTruthy();
		expect(screen.queryByRole("img", { name: "Current cover" })).toBeNull();
		expect(screen.getByText("Choose an image")).toBeTruthy();
	});

	it("posts a first job from the empty state and opens it", async () => {
		const router = renderAt("/dashboard/jobs");

		fireEvent.click(await screen.findByRole("link", { name: /Post your first job/ }));
		const title = await screen.findByLabelText("Job title");
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");

		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));
		expect(await screen.findByText("✕ Enter a job title between 2 and 120 characters")).toBeTruthy();
		expect(screen.getByText("✕ Describe the role: what they'll do and what they need")).toBeTruthy();

		fireEvent.change(title, { target: { value: "  Sprite   test role " } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Swift, SwiftUI, 5 years." } });
		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));

		expect(await screen.findByRole("heading", { level: 1, name: "Sprite test role" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1");
		expect(within(screen.getByRole("region", { name: "Notifications" })).getByText("Job opened. The apply page is live.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Status: Open" })).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Description" }));
		expect(await screen.findByText("Swift, SwiftUI, 5 years.")).toBeTruthy();
		expect(router.state.location.search).toEqual({ tab: "description" });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/jobs",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ title: "Sprite test role", description: "Swift, SwiftUI, 5 years.", status: "open" }),
			}),
		);

		fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: /Jobs/ }));
		expect(await screen.findByRole("link", { name: /Sprite test role/ })).toBeTruthy();
	});

	it("offers Post a job on the list once there are jobs, and Post your first job before", async () => {
		jobs = [];
		renderAt("/dashboard/jobs");
		expect(await screen.findByRole("link", { name: /Post your first job/ })).toBeTruthy();
		// The sidebar's shortcut is always there; the page's own button is what comes later.
		expect(within(screen.getByRole("main")).queryByRole("link", { name: /Post a job/ })).toBeNull();
		cleanup();

		jobs = [
			{
				id: "job_5",
				title: "Product Designer",
				description: "Figma",
				status: "open",
				createdAt: "2026-10-22T12:00:00Z",
				updatedAt: "2026-10-22T12:00:00Z",
			},
		];
		const router = renderAt("/dashboard/jobs");
		await screen.findByRole("link", { name: /Product Designer/ });
		const post = within(screen.getByRole("main")).getByRole("link", { name: /Post a job/ });
		expect(screen.queryByRole("link", { name: /New job/ })).toBeNull();
		expect(screen.queryByRole("link", { name: /Post your first job/ })).toBeNull();

		fireEvent.click(post);
		expect(await screen.findByRole("heading", { level: 1, name: "Post a job" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");
	});

	it("saves a draft, and rewrites rough notes with AI that the recruiter can undo", async () => {
		renderAt("/dashboard/jobs/new");

		fireEvent.click(await screen.findByRole("button", { name: "Improve with AI" }));
		expect(await screen.findByText("✕ Write a few notes first, then improve them")).toBeTruthy();

		const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
		fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		fireEvent.change(description, { target: { value: "swift 5y" } });
		fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));

		expect(await screen.findByText(/Rewritten with AI/)).toBeTruthy();
		expect(description.value).toBe("What you need:\n- swift 5y");
		const toasts = screen.getByRole("region", { name: "Notifications" });
		expect(within(toasts).getByText("Description rewritten")).toBeTruthy();
		// Undo rewrite, beside the field, puts the notes back and takes the toast away.
		fireEvent.click(screen.getByRole("button", { name: "Undo rewrite" }));
		expect(description.value).toBe("swift 5y");
		expect(within(toasts).queryByText("Description rewritten")).toBeNull();
		expect(screen.queryByText(/Rewritten with AI/)).toBeNull();

		// So does the toast's Undo.
		fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));
		expect(await within(toasts).findByText("Description rewritten")).toBeTruthy();
		fireEvent.click(within(toasts).getByRole("button", { name: "Undo" }));
		expect(description.value).toBe("swift 5y");

		// Editing the rewrite ends the undo, so an edit is never thrown away.
		fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));
		expect(await screen.findByRole("button", { name: "Undo rewrite" })).toBeTruthy();
		fireEvent.change(description, { target: { value: "What you need:\n- swift 5y\n- SwiftUI" } });
		expect(screen.queryByRole("button", { name: "Undo rewrite" })).toBeNull();
		expect(within(toasts).queryByText("Description rewritten")).toBeNull();

		// The primary button follows the status choice.
		expect(screen.getByRole("button", { name: /Open job/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
		expect(screen.queryByRole("button", { name: /Open job/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
		expect(await screen.findByRole("heading", { level: 1, name: "iOS Engineer" })).toBeTruthy();
		expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
		expect(within(toasts).getByText("Draft saved. Only your team can see it.")).toBeTruthy();
		expect(jobs[0]).toMatchObject({ title: "iOS Engineer", status: "draft", description: "What you need:\n- swift 5y\n- SwiftUI" });
	});

	it("saves with Ctrl+Enter from the description, and Escape there loses nothing", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		const description = screen.getByLabelText("Description");
		fireEvent.change(description, { target: { value: "swift 5y" } });

		fireEvent.keyDown(description, { key: "Escape" });
		expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("swift 5y");
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");
		expect(screen.queryByRole("alertdialog")).toBeNull();

		fireEvent.keyDown(description, { key: "Enter", ctrlKey: true });
		expect(await screen.findByRole("heading", { level: 1, name: "iOS Engineer" })).toBeTruthy();
		expect(jobs[0]).toMatchObject({ title: "iOS Engineer", status: "open" });
	});

	it("changes the status from the edit page, and Save changes says so", async () => {
		jobs = [{ id: "job_7", title: "Data Scientist", description: "Python", status: "open", createdAt: "2026-10-22T12:00:00Z", updatedAt: "2026-10-22T12:00:00Z" }];
		const router = renderAt("/dashboard/jobs/job_7/edit");
		const open = await screen.findByRole("radio", { name: "Open" });
		expect((open as HTMLInputElement).checked).toBe(true);
		// An open job can close, but it doesn't go back to being a draft.
		expect(screen.queryByRole("radio", { name: "Draft" })).toBeNull();
		expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Jobs/Data Scientist/Edit");

		fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
		expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientist" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_7");
		const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
		expect(JSON.parse(patch[1]!.body as string)).toEqual({ title: "Data Scientist", description: "Python", status: "closed" });
		expect(screen.getByText("Saved and closed. It takes no new CVs.")).toBeTruthy();
	});

	it("sends no status when only the words change", async () => {
		jobs = [{ id: "job_7", title: "Data Scientst", description: "Python", status: "open", createdAt: "2026-10-22T12:00:00Z", updatedAt: "2026-10-22T12:00:00Z" }];
		renderAt("/dashboard/jobs/job_7/edit");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "Data Scientist" } });
		fireEvent.keyDown(screen.getByLabelText("Job title"), { key: "Enter", metaKey: true });

		expect(await screen.findByText("Changes saved")).toBeTruthy();
		const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
		expect(JSON.parse(patch[1]!.body as string)).toEqual({ title: "Data Scientist", description: "Python" });
	});

	it("edits a job, then closes it", async () => {
		jobs = [
			{
				id: "job_7",
				title: "Data Scientst",
				description: "Python",
				status: "open",
				createdAt: "2026-10-22T12:00:00Z",
				updatedAt: "2026-10-22T12:00:00Z",
			},
		];
		const router = renderAt("/dashboard/jobs/job_7");

		await chooseMore("Edit job");
		const title = await screen.findByLabelText("Job title");
		fireEvent.change(title, { target: { value: "Data Scientist" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientist" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_7");

		// The menu says what the change does before it happens.
		fireEvent.click(screen.getByRole("button", { name: "Status: Open" }));
		expect(within(screen.getByRole("menu")).getByText("Stops new CVs. The apply page says the role is closed.")).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: /^Close job/ }));
		expect(await screen.findByRole("button", { name: "Status: Closed" })).toBeTruthy();
		// Said in a toast, which sits in a polite live region.
		const closed = await screen.findByText("Job closed");
		expect(closed.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");

		await chooseStatus(/^Reopen job/);
		expect(await screen.findByText("Job reopened")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Status: Open" })).toBeTruthy();
	});

	it("lets an admin delete a job after confirming", async () => {
		const job = (id: string, title: string, status: string) => ({
			id,
			title,
			description: "x",
			status,
			createdAt: "2026-10-22T12:00:00Z",
			updatedAt: "2026-10-22T12:00:00Z",
		});
		jobs = [job("job_9", "Sprite test role", "open"), job("job_8", "Product Designer", "closed")];
		const router = renderAt("/dashboard/jobs");

		fireEvent.click(await screen.findByRole("link", { name: /Sprite test role/ }));
		await chooseMore("Delete job");
		const dialog = await screen.findByRole("alertdialog", { name: "Delete “Sprite test role”?" });
		expect(document.activeElement).toHaveProperty("textContent", "Cancel");
		// The dialog is described by its body text.
		expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
			"It's removed for everyone at Sprite Labs. You can't undo this.",
		);
		// Hold the list's refetch, so the list can only show what the cache holds after the delete.
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			new URL(url).pathname === "/jobs" && init?.method === "GET" ? new Promise(() => {}) : answer(url, init),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete job" }));

		const deleted = await screen.findByText("Deleted “Sprite test role”");
		// Announced: the banner went into a polite live region that was already on the page.
		expect(deleted.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
		expect(router.state.location.pathname).toBe("/dashboard/jobs");
		const list = screen.getByRole("region", { name: "Your jobs" });
		expect(within(list).queryByText("Sprite test role")).toBeNull();
		expect(within(list).getByText("Product Designer")).toBeTruthy();
	});

	it("hides delete from members, and explains a job that doesn't exist", async () => {
		org = { id: "org_1", name: "Sprite Labs", role: "member" };
		jobs = [
			{
				id: "job_3",
				title: "Kept role",
				description: "x",
				status: "draft",
				createdAt: "2026-10-22T12:00:00Z",
				updatedAt: "2026-10-22T12:00:00Z",
			},
		];
		renderAt("/dashboard/jobs/job_3");
		expect(await screen.findByRole("heading", { level: 1, name: "Kept role" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(await screen.findByRole("menuitem", { name: "Edit job" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Delete job" })).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/missing");
		expect(await screen.findByText(/This job doesn't exist/)).toBeTruthy();
	});

	describe("search, filter, sort and pages", () => {
		const job = (n: number, fields: Partial<FakeJob> = {}): FakeJob => ({
			id: `job_${n}`,
			title: `Role ${String(n).padStart(2, "0")}`,
			description: "General duties",
			status: "open",
			createdAt: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
			updatedAt: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
			...fields,
		});
		const jobRequests = () =>
			fetchMock.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname === "/jobs");
		const lastJobQuery = () => jobRequests().at(-1)!.search;
		const main = () => within(screen.getByRole("main"));
		const tab = (name: RegExp) => within(screen.getByRole("navigation", { name: "Job status" })).getByRole("link", { name });
		// The job titles down the list, in order.
		const rowTitles = () =>
			[...screen.getByRole("region", { name: "Your jobs" }).querySelectorAll("[data-row-link]")].map((link) => link.textContent);
		// Backend Engineer: one to review, one shortlisted, one being read, one failed, the latest CV. Data Analyst: two to
		// review and one not a fit, from earlier in the month. Product Designer has none.
		const withPipelines = () => {
			candidates = [
				fakeCandidate({ id: "c1", jobId: "job_1", name: "Grace Turner", score: 80, createdAt: "2026-10-20T09:00:00Z" }),
				fakeCandidate({ id: "c2", jobId: "job_1", score: 60, decision: "shortlisted", createdAt: "2026-10-19T09:00:00Z" }),
				fakeCandidate({ id: "c3", jobId: "job_1", status: "queued", createdAt: "2026-10-20T10:00:00Z" }),
				fakeCandidate({ id: "c4", jobId: "job_1", status: "failed", createdAt: "2026-10-18T09:00:00Z" }),
				fakeCandidate({ id: "d1", jobId: "job_3", score: 70, createdAt: "2026-10-05T09:00:00Z" }),
				fakeCandidate({ id: "d2", jobId: "job_3", score: 50, createdAt: "2026-10-04T09:00:00Z" }),
				fakeCandidate({ id: "d3", jobId: "job_3", score: 30, decision: "rejected", createdAt: "2026-10-03T09:00:00Z" }),
			];
		};

		beforeEach(() => {
			jobs = [
				job(1, { title: "Backend Engineer", description: "Go and Rust", status: "open", cvCount: 4 }),
				job(2, { title: "Product Designer", description: "Figma craft", status: "draft" }),
				job(3, { title: "Data Analyst", description: "SQL reporting", status: "closed", cvCount: 9 }),
			];
		});

		it("shows the count, the status tabs with their counts, the toolbar and Post a job", async () => {
			renderAt("/dashboard/jobs");
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
			expect(main().getByText("1 open · 1 draft · 1 closed")).toBeTruthy();
			const tabs = within(screen.getByRole("navigation", { name: "Job status" })).getAllByRole("link");
			expect(tabs.map((link) => link.textContent)).toEqual(["All3", "Open1", "Drafts1", "Closed1"]);
			expect(tabs.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null, null, null]);
			expect(screen.getByRole("search", { name: "Search and sort jobs" })).toBeTruthy();
			expect(screen.getByLabelText("Search jobs")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Sort by Newest" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
			expect(main().getByRole("link", { name: /Post a job/ })).toBeTruthy();
		});

		it("searches after a pause, keeps the words in the address and says what it found", async () => {
			const router = renderAt("/dashboard/jobs");
			const box = (await screen.findByLabelText("Search jobs")) as HTMLInputElement;

			fireEvent.change(box, { target: { value: "  figma " } });
			expect(jobRequests().some((url) => url.searchParams.has("q"))).toBe(false);
			await waitFor(() => expect(jobRequests().map((url) => url.search)).toContain("?q=figma"));
			expect(await screen.findByText("Showing 1–1 of 1")).toBeTruthy();
			expect(main().getByText("1 job found")).toBeTruthy();
			// In the page: the sidebar lists the open jobs too.
			expect(main().getByRole("link", { name: /Product Designer/ })).toBeTruthy();
			expect(main().queryByRole("link", { name: /Backend Engineer/ })).toBeNull();
			expect(router.state.location.search).toMatchObject({ q: "figma" });
			expect(box.value).toBe("  figma ");
			// The tabs count what the search found; the summary under the title stays the whole company's.
			expect(tab(/^All/).textContent).toBe("All1");
			expect(tab(/^Open/).textContent).toBe("Open0");
			expect(main().getByText("1 open · 1 draft · 1 closed")).toBeTruthy();
		});

		it("jumps to the search box on /, and Escape empties it", async () => {
			const router = renderAt("/dashboard/jobs?q=sql");
			const box = (await screen.findByLabelText("Search jobs")) as HTMLInputElement;
			await screen.findByText("Showing 1–1 of 1");

			fireEvent.keyDown(document.body, { key: "/" });
			expect(document.activeElement).toBe(box);
			fireEvent.keyDown(box, { key: "Escape" });
			expect(box.value).toBe("");
			await waitFor(() => expect(router.state.location.search).toEqual({}));
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
		});

		it("filters by status from the tabs and sorts from the menu, and Clear filters puts everything back", async () => {
			withPipelines();
			const router = renderAt("/dashboard/jobs");
			await screen.findByText("Showing 1–3 of 3");
			expect(rowTitles()).toEqual(["Data Analyst", "Product Designer", "Backend Engineer"]);

			fireEvent.click(tab(/^Drafts/));
			expect(await screen.findByText("Showing 1–1 of 1")).toBeTruthy();
			expect(lastJobQuery()).toBe("?status=draft");
			expect(tab(/^Drafts/).getAttribute("aria-current")).toBe("page");
			expect(tab(/^All/).getAttribute("aria-current")).toBeNull();
			// The counts are every status's, whichever one is shown.
			expect(tab(/^All/).textContent).toBe("All3");

			fireEvent.click(tab(/^All/));
			await screen.findByText("Showing 1–3 of 3");
			fireEvent.click(screen.getByRole("button", { name: "Sort by Newest" }));
			const menu = screen.getByRole("menu");
			expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
				"Newest",
				"Recent activity",
				"Most to review",
				"Title A–Z",
				"Oldest",
			]);
			expect(within(menu).getByRole("menuitemradio", { name: "Newest" }).getAttribute("aria-checked")).toBe("true");
			fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Most to review" }));
			await waitFor(() => expect(lastJobQuery()).toBe("?sort=review"));
			await waitFor(() => expect(rowTitles()).toEqual(["Data Analyst", "Backend Engineer", "Product Designer"]));

			fireEvent.click(screen.getByRole("button", { name: "Sort by Most to review" }));
			fireEvent.click(screen.getByRole("menuitemradio", { name: "Recent activity" }));
			await waitFor(() => expect(rowTitles()).toEqual(["Backend Engineer", "Data Analyst", "Product Designer"]));
			expect(router.state.location.search).toEqual({ sort: "activity" });

			fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
			await waitFor(() => expect(router.state.location.search).toEqual({}));
			expect(screen.getByRole("button", { name: "Sort by Newest" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
		});

		it("still sorts by most candidates from an old link, and lists that sort while it's chosen", async () => {
			renderAt("/dashboard/jobs?sort=candidates");
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
			expect(lastJobQuery()).toBe("?sort=candidates");
			expect(rowTitles()).toEqual(["Data Analyst", "Backend Engineer", "Product Designer"]);

			fireEvent.click(screen.getByRole("button", { name: "Sort by Most candidates" }));
			expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
				"Newest",
				"Recent activity",
				"Most to review",
				"Title A–Z",
				"Oldest",
				"Most candidates",
			]);
			expect(screen.getByRole("menuitemradio", { name: "Most candidates" }).getAttribute("aria-checked")).toBe("true");
		});

		it("reads its filters from the address", async () => {
			renderAt("/dashboard/jobs?status=closed&sort=title&q=sql");
			expect(await screen.findByText("Showing 1–1 of 1")).toBeTruthy();
			expect((screen.getByLabelText("Search jobs") as HTMLInputElement).value).toBe("sql");
			expect(tab(/^Closed/).getAttribute("aria-current")).toBe("page");
			expect(screen.getByRole("button", { name: "Sort by Title A–Z" })).toBeTruthy();
			expect(main().getByRole("link", { name: /Data Analyst/ })).toBeTruthy();
		});

		it("says No jobs match, which is not No jobs yet, and offers Clear filters", async () => {
			renderAt("/dashboard/jobs?q=zzz");
			expect(await screen.findByRole("heading", { name: "No jobs match" })).toBeTruthy();
			expect(screen.queryByRole("heading", { name: "No jobs yet" })).toBeNull();
			expect(screen.queryByRole("link", { name: /Post your first job/ })).toBeNull();
			// The toolbar stays, so the search can be changed.
			expect(screen.getByLabelText("Search jobs")).toBeTruthy();

			fireEvent.click(within(screen.getByRole("region", { name: "No jobs match" })).getByRole("button", { name: "Clear filters" }));
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
		});

		it("says why a status tab is empty, and goes back to every job", async () => {
			jobs = jobs.filter((j) => j.status !== "draft");
			renderAt("/dashboard/jobs?status=draft");
			const empty = await screen.findByRole("region", { name: "No drafts" });
			expect(within(empty).getByText(/waits here until you open it/)).toBeTruthy();

			fireEvent.click(within(empty).getByRole("button", { name: "Show all jobs" }));
			expect(await screen.findByText("Showing 1–2 of 2")).toBeTruthy();
		});

		it("shows each job's pipeline in words and as a bar, with its top match", async () => {
			withPipelines();
			renderAt("/dashboard/jobs");
			const list = await screen.findByRole("region", { name: "Your jobs" });

			const backend = within(list).getByRole("img", { name: "Pipeline: 1 to review, 1 shortlisted, 1 reading, 1 failed" });
			expect(backend.querySelector("p")?.textContent).toBe("1 to review · 1 shortlisted · 1 reading · ✕ 1 failed");
			const analyst = within(list).getByRole("img", { name: "Pipeline: 2 to review, 0 shortlisted, 1 not a fit" });
			expect(analyst.querySelector("p")?.textContent).toBe("2 to review · 0 shortlisted");
			expect(within(list).getByRole("img", { name: "Pipeline: No CVs yet" })).toBeTruthy();
			// The bar's parts grow with their counts: shortlisted, to review, reading (failed CVs have none).
			expect([...backend.querySelectorAll<HTMLElement>("[style]")].map((part) => part.style.flexGrow)).toEqual(["1", "1", "1"]);
			expect([...analyst.querySelectorAll<HTMLElement>("[style]")].map((part) => part.style.flexGrow)).toEqual(["2", "1"]);

			const top = within(list).getByRole("link", { name: "Top match 80, Grace Turner" });
			expect(top.getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/c1");
			expect(top.textContent).toBe("80Grace");
			expect(within(list).getAllByText("No scored CVs yet")).toHaveLength(1);
			// CVs are counted without "(N scored)": the pipeline says it.
			expect(within(list).getByText("Created 1 Oct 2026 · 4 CVs")).toBeTruthy();
			expect(within(list).queryByText(/scored\)/)).toBeNull();
		});

		it("pages through more than 20 jobs", async () => {
			jobs = Array.from({ length: 25 }, (_, i) => job(i + 1));
			const router = renderAt("/dashboard/jobs");
			expect(await screen.findByText("Showing 1–20 of 25")).toBeTruthy();
			expect(screen.getByText("Page 1 of 2")).toBeTruthy();
			expect(screen.getByText("Previous").getAttribute("aria-disabled")).toBe("true");

			fireEvent.click(screen.getByRole("link", { name: "Next" }));
			expect(await screen.findByText("Showing 21–25 of 25")).toBeTruthy();
			expect(router.state.location.search).toMatchObject({ page: 2 });
			expect(screen.getByText("Next").getAttribute("aria-disabled")).toBe("true");

			fireEvent.click(screen.getByRole("link", { name: "Previous" }));
			expect(await screen.findByText("Showing 1–20 of 25")).toBeTruthy();
		});

		it("goes back to page 1 when the page asked for is past the end", async () => {
			const router = renderAt("/dashboard/jobs?page=9");
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
			expect(router.state.location.search).toEqual({});
		});

		it("says so when the list can't load, and loads it on Try again", async () => {
			const answer = fetchMock.getMockImplementation()!;
			let fail = true;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				fail && new URL(url).pathname === "/jobs"
					? Promise.resolve(apiError(500, "internal_error", "Something went wrong on our side. Try again."))
					: answer(url, init),
			);
			renderAt("/dashboard/jobs");
			const alert = await screen.findByRole("alert");
			expect(alert.textContent).toContain("We couldn't load your jobs");
			fail = false;
			fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
			expect(await screen.findByText("Showing 1–3 of 3")).toBeTruthy();
		});
	});

	describe("row actions and duplicating", () => {
		const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
		// A menu item's own words, without the line under it that some items have.
		const labels = (items: HTMLElement[]) => items.map((item) => item.querySelector(".truncate")?.textContent);

		beforeEach(() => {
			jobs = [
				{
					id: "job_1",
					title: "Backend Engineer",
					description: "Go and Rust",
					status: "open",
					cvCount: 2,
					createdAt: "2026-10-22T12:00:00Z",
					updatedAt: "2026-10-22T12:00:00Z",
				},
			];
		});

		it("opens a menu for each job, closes it with Escape and gives focus back", async () => {
			renderAt("/dashboard/jobs");
			const button = await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			expect(button.getAttribute("aria-expanded")).toBe("false");

			fireEvent.click(button);
			const menu = screen.getByRole("menu", { name: "Actions for Backend Engineer" });
			expect(button.getAttribute("aria-expanded")).toBe("true");
			expect(labels(within(menu).getAllByRole("menuitem"))).toEqual([
				"View job",
				"Edit job",
				"Duplicate",
				"Copy apply link",
				"Share",
				"Close job",
				"Delete job",
			]);
			expect(within(menu).getByRole("menuitem", { name: /^Close job/ }).textContent).toContain("Stops new CVs.");
			expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "View job" }));

			fireEvent.keyDown(menu, { key: "ArrowDown" });
			expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Edit job" }));
			fireEvent.keyDown(menu, { key: "End" });
			expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Delete job" }));
			fireEvent.keyDown(menu, { key: "Escape" });
			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(button);
		});

		it("opens the job's page and its edit page from the menu", async () => {
			const router = renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			expect(screen.getByRole("menuitem", { name: "View job" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
			fireEvent.click(screen.getByRole("menuitem", { name: "Edit job" }));
			expect(await screen.findByLabelText("Job title")).toBeTruthy();
			expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1/edit");
		});

		it("duplicates from the menu and opens the copy's edit page as a draft", async () => {
			const router = renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

			expect(await screen.findByText("Duplicated as a draft")).toBeTruthy();
			expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("Backend Engineer (copy)");
			expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Go and Rust");
			expect(router.state.location.pathname).toBe("/dashboard/jobs/job_2/edit");
			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:8787/jobs/job_1/duplicate",
				expect.objectContaining({ method: "POST" }),
			);
			expect(jobs[0]).toMatchObject({ title: "Backend Engineer (copy)", status: "draft", cvCount: 0 });
		});

		it("duplicates from the job page next to Edit job", async () => {
			renderAt("/dashboard/jobs/job_1");
			fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
			const edit = await screen.findByRole("menuitem", { name: "Edit job" });
			const duplicate = screen.getByRole("menuitem", { name: /^Duplicate/ });
			expect(edit.compareDocumentPosition(duplicate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

			fireEvent.click(duplicate);
			expect(await screen.findByText("Duplicated as a draft")).toBeTruthy();
			expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("Backend Engineer (copy)");
		});

		it("shows the real reason when the copy can't be made", async () => {
			const answer = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				url.endsWith("/duplicate")
					? Promise.resolve(apiError(403, "job_limit", "You've used this month's jobs. Wait for next month."))
					: answer(url, init),
			);
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

			const toast = await within(screen.getByRole("region", { name: "Notifications" })).findByText(
				"You've used this month's jobs. Wait for next month.",
			);
			expect(toast.textContent).toBe("✕ Error: You've used this month's jobs. Wait for next month.");
			expect(toast.textContent).not.toMatch(/upgrade/i);
			expect(jobs).toHaveLength(1);
		});

		it("deletes only after confirming, and says so", async () => {
			// Three CVs were uploaded and one deleted: the dialog counts the two still on the job.
			jobs[0]!.cvCount = 3;
			candidates = [fakeCandidate({ id: "c1", score: 80 }), fakeCandidate({ id: "c2", status: "queued" })];
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete job" }));

			const dialog = await screen.findByRole("alertdialog", { name: "Delete “Backend Engineer”?" });
			expect(dialog.textContent).toContain("It and its 2 CVs are removed for everyone at Sprite Labs.");
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
			expect(screen.queryByRole("alertdialog")).toBeNull();
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Backend Engineer" }));
			expect(jobs).toHaveLength(1);

			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete job" }));
			fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete job" }));
			const deleted = await screen.findByText("Deleted “Backend Engineer”");
			expect(deleted.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
			expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeTruthy();
			expect(jobs).toHaveLength(0);
			// The list is gone, so focus goes to the first thing in its place rather than being lost.
			await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: /Post your first job/ })));
		});

		it("moves focus to the next job after a delete from the list", async () => {
			jobs = [
				{ ...jobs[0]!, id: "job_1", title: "First role", createdAt: "2026-10-22T12:00:00Z" },
				{ ...jobs[0]!, id: "job_2", title: "Second role", createdAt: "2026-10-21T12:00:00Z" },
				{ ...jobs[0]!, id: "job_3", title: "Third role", createdAt: "2026-10-20T12:00:00Z" },
			];
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Second role" });
			open("Second role");
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete job" }));
			fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete job" }));

			expect(await screen.findByText("Deleted “Second role”")).toBeTruthy();
			await waitFor(() => expect(document.activeElement?.textContent).toBe("Third role"));
		});

		it("leaves Delete out for members", async () => {
			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			expect(labels(screen.getAllByRole("menuitem"))).toEqual([
				"View job",
				"Edit job",
				"Duplicate",
				"Copy apply link",
				"Share",
				"Close job",
			]);
		});

		it("copies the apply link from the menu and says so", async () => {
			const writeText = vi.fn(async () => {});
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: "Copy apply link" }));

			await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://lucidhire.io/jobs/job_1-slug"));
			expect(await screen.findByText("Apply link copied")).toBeTruthy();
			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Backend Engineer" }));
		});

		it("shares to the same places as the job page", async () => {
			const writeText = vi.fn(async (_text: string) => {});
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			const share = screen.getByRole("menuitem", { name: "Share" });
			expect(share.getAttribute("aria-expanded")).toBe("false");
			fireEvent.click(share);

			const group = screen.getByRole("group", { name: "Share this job" });
			expect(within(group).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
				"Email",
				"X",
				"LinkedIn",
				"WhatsApp",
				"Facebook",
				"Copy caption",
			]);
			const linkedin = within(group).getByRole("menuitem", { name: "LinkedIn" });
			expect(linkedin.getAttribute("href")).toContain(encodeURIComponent("https://lucidhire.io/jobs/job_1-slug"));
			expect(linkedin.getAttribute("target")).toBe("_blank");

			fireEvent.click(within(group).getByRole("menuitem", { name: "Copy caption" }));
			await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
			expect(writeText.mock.calls[0]?.[0]).toContain("Apply here: https://lucidhire.io/jobs/job_1-slug");
			expect(await screen.findByText("Caption copied")).toBeTruthy();
		});

		it("has no public link for a draft, and no sharing for a closed job", async () => {
			jobs = [
				{ ...jobs[0]!, status: "draft" },
				{ ...jobs[0]!, id: "job_2", title: "Closed role", status: "closed" },
			];
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			open("Backend Engineer");
			expect(screen.queryByRole("menuitem", { name: "Copy apply link" })).toBeNull();
			expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
			expect(screen.getByRole("menuitem", { name: /^Open job/ })).toBeTruthy();
			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

			open("Closed role");
			expect(screen.getByRole("menuitem", { name: "Copy apply link" })).toBeTruthy();
			expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
			expect(screen.getByRole("menuitem", { name: /^Reopen job/ })).toBeTruthy();
		});

		it("closes a job from the menu, says so, and Undo opens it again", async () => {
			renderAt("/dashboard/jobs");
			await screen.findByRole("button", { name: "Actions for Backend Engineer" });
			const row = () => screen.getByRole("button", { name: "Actions for Backend Engineer" }).closest("li")!;
			const patches = () =>
				fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(init!.body as string));
			open("Backend Engineer");
			fireEvent.click(screen.getByRole("menuitem", { name: /^Close job/ }));

			const notifications = within(screen.getByRole("region", { name: "Notifications" }));
			expect(await notifications.findByText("Closed “Backend Engineer”")).toBeTruthy();
			expect(patches()).toEqual([{ status: "closed" }]);
			await waitFor(() => expect(within(row()).getAllByText("Closed").length).toBeGreaterThan(0));
			expect(screen.getByRole("navigation", { name: "Job status" }).textContent).toContain("Closed1");

			fireEvent.click(notifications.getByRole("button", { name: "Undo" }));
			await waitFor(() => expect(patches()).toEqual([{ status: "closed" }, { status: "open" }]));
			await waitFor(() => expect(within(row()).getAllByText("Open").length).toBeGreaterThan(0));
			expect(jobs[0]!.status).toBe("open");
		});
	});
});

describe("unsaved changes on the job form", () => {
	const dataScientist = (): FakeJob => ({
		id: "job_7",
		title: "Data Scientst",
		description: "Python",
		status: "draft",
		createdAt: "2026-10-22T12:00:00Z",
		updatedAt: "2026-10-22T12:00:00Z",
	});
	// What the browser does when the tab is closed or reloaded: true if something asked to hold it back.
	const unloadIsHeldBack = () => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	};
	// The dialog goes once the blocker has been told which way to go, which takes a tick.
	const dialogGone = () => waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	let confirm: MockInstance<typeof window.confirm>;

	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
		jobs = [dataScientist()];
		confirm = vi.spyOn(window, "confirm");
	});

	afterEach(() => confirm.mockRestore());

	it("asks before Cancel throws away typing on a new job, and stays on Keep editing", async () => {
		const router = renderAt("/dashboard/jobs/new");
		const title = (await screen.findByLabelText("Job title")) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "iOS Engineer" } });
		const cancel = screen.getByRole("link", { name: "Cancel" });
		cancel.focus();

		fireEvent.click(cancel);
		const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
		expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
			"Your changes to this job aren't saved.",
		);
		expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Keep editing", "Leave"]);
		expect(document.activeElement).toHaveProperty("textContent", "Keep editing");
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");

		// Tab stays inside the dialog.
		within(dialog).getByRole("button", { name: "Leave" }).focus();
		expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
		expect(document.activeElement).toHaveProperty("textContent", "Keep editing");

		// Escape is Keep editing: the form is as it was, and focus is back on the link that was clicked.
		fireEvent.keyDown(document, { key: "Escape" });
		await dialogGone();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/new");
		expect(title.value).toBe("iOS Engineer");
		expect(document.activeElement).toBe(cancel);

		// Leave goes where the link goes.
		fireEvent.click(cancel);
		fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Jobs" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs");
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(confirm).not.toHaveBeenCalled();
	});

	it("lets a form nobody has typed in go at once, by Cancel or any other link", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.click(await screen.findByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Jobs" })).toBeTruthy();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(router.state.location.pathname).toBe("/dashboard/jobs");
	});

	it("asks before any link leaves an edited job, and lets go once the edit is undone", async () => {
		const router = renderAt("/dashboard/jobs/job_7/edit");
		const title = (await screen.findByLabelText("Job title")) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "Data Scientist" } });

		fireEvent.click(screen.getByRole("link", { name: "LucidHire dashboard" }));
		expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		await dialogGone();
		fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: /Jobs/ }));
		expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		await dialogGone();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_7/edit");

		// The same words as before: nothing to lose.
		fireEvent.change(title, { target: { value: "Data Scientst" } });
		fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientst" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_7");
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("holds back closing the tab only while there is something unsaved", async () => {
		// Only a browser history listens for the tab closing.
		window.history.replaceState({}, "", "/dashboard/jobs/new");
		const router = createAppRouter(createBrowserHistory());
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		try {
			const title = await screen.findByLabelText("Job title");
			expect(unloadIsHeldBack()).toBe(false);

			fireEvent.change(title, { target: { value: "iOS Engineer" } });
			await waitFor(() => expect(unloadIsHeldBack()).toBe(true));
			fireEvent.change(title, { target: { value: "" } });
			await waitFor(() => expect(unloadIsHeldBack()).toBe(false));
		} finally {
			router.history.destroy();
			window.history.replaceState({}, "", "/");
		}
	});

	it("asks before leaving an edit whose only change is the status", async () => {
		jobs = [{ ...dataScientist(), status: "open" }];
		renderAt("/dashboard/jobs/job_7/edit");
		fireEvent.click(await screen.findByRole("radio", { name: "Closed" }));
		fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		await dialogGone();

		// Back to how it was saved: nothing to lose.
		fireEvent.click(screen.getByRole("radio", { name: "Open" }));
		fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientst" })).toBeTruthy();
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("lets a new job go when only the status was flipped", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.click(await screen.findByRole("radio", { name: "Draft" }));
		fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Jobs" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs");
	});

	it("never holds back a save: Open job, Save draft and Save changes go straight through", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "swift 5y" } });
		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));

		expect(await screen.findByRole("heading", { level: 1, name: "iOS Engineer" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_2");
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(unloadIsHeldBack()).toBe(false);
		cleanup();

		const second = renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "Product Designer" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "figma" } });
		fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
		fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Product Designer" })).toBeTruthy();
		expect(second.state.location.pathname).toBe("/dashboard/jobs/job_3");
		expect(screen.queryByRole("alertdialog")).toBeNull();
		cleanup();

		const third = renderAt("/dashboard/jobs/job_7/edit");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "Data Scientist" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientist" })).toBeTruthy();
		expect(third.state.location.pathname).toBe("/dashboard/jobs/job_7");
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(unloadIsHeldBack()).toBe(false);
		expect(confirm).not.toHaveBeenCalled();
	});
});

describe("page states and focus", () => {
	const keptRole = (fields: Partial<FakeJob> = {}): FakeJob => ({
		id: "job_3",
		title: "Kept role",
		description: "Swift, SwiftUI, 5 years.",
		status: "open",
		createdAt: "2026-10-22T12:00:00Z",
		updatedAt: "2026-10-22T12:00:00Z",
		...fields,
	});
	// Makes the requests `match` picks fail with `respond`'s answer; everything else is answered as before.
	const failRequests = (match: (url: string) => boolean, respond: () => Promise<Response>) => {
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) => (match(url) ? respond() : answer(url, init)));
	};

	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
		jobs = [keptRole()];
	});

	it("moves focus to the page's h1 when a page opens, and draws no ring on it", async () => {
		renderAt("/dashboard/jobs");

		const heading = await screen.findByRole("heading", { level: 1, name: "Jobs" });
		await waitFor(() => expect(document.activeElement).toBe(heading));
		expect(heading.getAttribute("tabindex")).toBe("-1");
		expect(heading.className).toContain("focus:outline-none");

		fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: /Kept role/ }));
		const title = await screen.findByRole("heading", { level: 1, name: "Kept role" });
		await waitFor(() => expect(document.activeElement).toBe(title));
	});

	it("gives a page that is loading an h1 for screen readers", async () => {
		const loading = hold((url) => url.endsWith("/jobs/job_3"));
		renderAt("/dashboard/jobs/job_3");

		const heading = await screen.findByRole("heading", { level: 1, name: "Loading job" });
		expect(heading.className).toContain("sr-only");
		await act(async () => loading.release());
		expect(await screen.findByRole("heading", { level: 1, name: "Kept role" })).toBeTruthy();
	});

	it("words every wait as Loading, on the page it is for", async () => {
		const account = hold((url) => url.endsWith("/me"));
		renderAt("/dashboard");
		expect(await screen.findByRole("heading", { level: 1, name: "Loading your dashboard" })).toBeTruthy();
		await act(async () => account.release());
		cleanup();

		org = null;
		const onboarding = hold((url) => url.endsWith("/me"));
		renderAt("/onboarding");
		expect(await screen.findByRole("heading", { level: 1, name: "Loading your account" })).toBeTruthy();
		await act(async () => onboarding.release());
	});

	it("words the wait for a job, a job to edit and a candidate the same way", async () => {
		candidates = [fakeCandidate({ id: "cand_grace", jobId: "job_3" })];
		const waiting = hold((url) => /\/jobs\/job_3(\/candidates\/cand_grace)?$/.test(url));

		renderAt("/dashboard/jobs/job_3/edit");
		expect(await screen.findByRole("heading", { level: 1, name: "Loading job" })).toBeTruthy();
		cleanup();

		renderAt("/dashboard/jobs/job_3/candidates/cand_grace");
		expect(await screen.findByRole("heading", { level: 1, name: "Loading candidate" })).toBeTruthy();
		await act(async () => waiting.release());
	});

	it("makes an error that is the whole page its h1, and keeps h2 for one inside a page", async () => {
		renderAt("/dashboard/jobs/missing");
		expect(await screen.findByRole("heading", { level: 1, name: "✕ This job doesn't exist" })).toBeTruthy();
		cleanup();

		renderAt("/dashboard/jobs/job_3/candidates/missing");
		expect(await screen.findByRole("heading", { level: 1, name: "✕ This candidate doesn't exist" })).toBeTruthy();
		cleanup();

		// A job is asked for twice before it counts as failed, a second apart.
		const couldntLoad = { level: 1, name: "✕ We couldn't load this job" };
		failRequests((url) => url.endsWith("/jobs/job_3"), async () => apiError(503, "unavailable", "Try again later"));
		renderAt("/dashboard/jobs/job_3");
		expect(await screen.findByRole("heading", couldntLoad, { timeout: 3000 })).toBeTruthy();
		cleanup();
		renderAt("/dashboard/jobs/job_3/edit");
		expect(await screen.findByRole("heading", couldntLoad, { timeout: 3000 })).toBeTruthy();
		cleanup();

		// The jobs list already sits under the page's own "Jobs".
		failRequests((url) => url.endsWith("/jobs"), async () => apiError(503, "unavailable", "Try again later"));
		renderAt("/dashboard/jobs");
		expect(await screen.findByRole("heading", { level: 2, name: "✕ We couldn't load your jobs" })).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	});

	it("says in plain words when the API can't be reached or has nothing to say", async () => {
		failRequests((url) => url.endsWith("/jobs"), async () => Promise.reject(new TypeError("Failed to fetch")));
		renderAt("/dashboard/jobs");
		expect(await screen.findByText("We couldn't reach LucidHire. Check your connection and try again.")).toBeTruthy();
		expect(screen.queryByText(/Failed to fetch/)).toBeNull();
		cleanup();

		failRequests((url) => url.endsWith("/jobs"), async () => new Response("<html>Bad gateway</html>", { status: 502 }));
		renderAt("/dashboard/jobs");
		expect(await screen.findByText("Something went wrong on our side. Try again.")).toBeTruthy();
		expect(screen.queryByText(/Request failed with/)).toBeNull();
	});

	it("shows a page for an address that matches nothing, with a link back for signed-in and signed-out visitors", async () => {
		renderAt("/dashboard/nowhere");
		expect(await screen.findByRole("heading", { level: 1, name: "✕ This page does not exist" })).toBeTruthy();
		expect(document.title).toBe("Page not found · LucidHire");
		expect(screen.getByRole("link", { name: "Open your dashboard" }).getAttribute("href")).toBe("/dashboard");
		expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
		cleanup();

		session.signedIn = false;
		renderAt("/nowhere");
		expect(await screen.findByRole("heading", { level: 1, name: "✕ This page does not exist" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
		expect(screen.queryByRole("link", { name: "Open your dashboard" })).toBeNull();
	});

	it("catches a page that crashes, says so plainly and offers to try again", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// A date nobody can format crashes the list while it renders.
			jobs = [keptRole({ createdAt: "not a date" })];
			renderAt("/dashboard/jobs");

			expect(await screen.findByRole("heading", { level: 1, name: "✕ Something went wrong" })).toBeTruthy();
			expect(screen.getByText("This page hit a problem. Try again.")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
			expect(screen.queryByText(/RangeError|Invalid time/)).toBeNull();
		} finally {
			logged.mockRestore();
		}
	});

	it("focuses the first field with a problem when a job is saved", async () => {
		renderAt("/dashboard/jobs/new");
		const title = await screen.findByLabelText("Job title");

		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));
		expect(document.activeElement).toBe(title);

		fireEvent.change(title, { target: { value: "iOS Engineer" } });
		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));
		expect(document.activeElement).toBe(screen.getByLabelText("Description"));
	});

	it("keeps the save buttons focusable while a job saves, and saves it once", async () => {
		renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "swift 5y" } });
		const saving = hold((url, init) => url.endsWith("/jobs") && init?.method === "POST");
		fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
		const draft = screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement;
		draft.focus();

		fireEvent.click(draft);
		await waitFor(() => expect(saving.pending()).toBe(1));
		expect(draft.getAttribute("aria-disabled")).toBe("true");
		expect(draft.disabled).toBe(false);
		expect(document.activeElement).toBe(draft);
		// Neither a second click nor Ctrl+Enter saves it again while it is busy.
		fireEvent.click(draft);
		fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
		fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter", ctrlKey: true });
		expect(saving.pending()).toBe(1);

		await act(async () => saving.release());
		expect(await screen.findByRole("heading", { level: 1, name: "iOS Engineer" })).toBeTruthy();
		expect(jobs.filter((job) => job.title === "iOS Engineer")).toHaveLength(1);
	});

	it("keeps Retry focusable on the candidate page while it retries", async () => {
		candidates = [
			fakeCandidate({
				id: "cand_bad",
				fileName: "scan.pdf",
				status: "failed",
				error: "Scoring failed. Try again.",
				canRetry: true,
			}),
		];
		jobs = [{ ...keptRole({ id: "job_1" }), cvCount: 1 }];
		renderAt("/dashboard/jobs/job_1/candidates/cand_bad");
		const retry = (await screen.findByRole("button", { name: "Retry" })) as HTMLButtonElement;
		const retrying = hold((url, init) => init?.method === "POST" && url.endsWith("/retry"));
		retry.focus();

		fireEvent.click(retry);
		await waitFor(() => expect(retrying.pending()).toBe(1));
		expect(retry.textContent).toBe("Retrying");
		expect(retry.getAttribute("aria-disabled")).toBe("true");
		expect(retry.disabled).toBe(false);
		expect(document.activeElement).toBe(retry);
		fireEvent.click(retry);
		expect(retrying.pending()).toBe(1);
		await act(async () => retrying.release());
	});

	it("keeps Improve with AI focusable while it rewrites, and asks once", async () => {
		renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "swift 5y" } });
		const rewriting = hold((url) => url.endsWith("/jobs/enhance"));
		const improve = screen.getByRole("button", { name: "Improve with AI" }) as HTMLButtonElement;
		improve.focus();

		fireEvent.click(improve);
		await waitFor(() => expect(rewriting.pending()).toBe(1));
		expect(improve.textContent).toBe("Rewriting");
		expect(improve.getAttribute("aria-disabled")).toBe("true");
		expect(improve.disabled).toBe(false);
		expect(document.activeElement).toBe(improve);
		fireEvent.click(improve);
		expect(rewriting.pending()).toBe(1);

		await act(async () => rewriting.release());
		expect(await screen.findByText(/Rewritten with AI/)).toBeTruthy();
		expect(improve.getAttribute("aria-disabled")).toBe("false");
	});

	it("keeps the status button focusable while it saves, and ignores a second click", async () => {
		renderAt("/dashboard/jobs/job_3");
		const status = (await screen.findByRole("button", { name: "Status: Open" })) as HTMLButtonElement;
		const saving = hold((_url, init) => init?.method === "PATCH");

		fireEvent.click(status);
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Close job/ }));
		await waitFor(() => expect(saving.pending()).toBe(1));
		expect(status.textContent).toBe("Saving");
		expect(status.getAttribute("aria-disabled")).toBe("true");
		expect(status.disabled).toBe(false);
		// The menu hands focus back to its button, which keeps it while the job saves.
		expect(document.activeElement).toBe(status);
		fireEvent.click(status);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(saving.pending()).toBe(1);

		await act(async () => saving.release());
		expect(await screen.findByText("Job closed")).toBeTruthy();
		expect(status.textContent).toBe("Status: Closed");
		expect(status.getAttribute("aria-disabled")).toBe("false");
	});
});

describe("choosing a plan before signing up", () => {
	beforeEach(() => {
		// The landing page reads media queries and watches scrolling; jsdom has neither.
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: false,
			media: query,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
		}));
		for (const name of ["IntersectionObserver", "ResizeObserver"]) {
			vi.stubGlobal(
				name,
				class {
					observe() {}
					unobserve() {}
					disconnect() {}
				},
			);
		}
	});
	afterEach(() => sessionStorage.clear());

	it("sends the pricing buttons to sign-up with the plan, and Free without one", async () => {
		session.signedIn = false;
		renderAt("/");
		const href = async (name: string) => (await screen.findByRole("link", { name })).getAttribute("href");

		expect(await href("Choose Pro")).toBe("/sign-up?plan=pro");
		expect(await href("Choose Max")).toBe("/sign-up?plan=max");
		expect(await href("Start free")).toBe("/sign-up");
	});

	it("sends signed-in visitors from a pricing button to the plan cards", async () => {
		renderAt("/");
		expect((await screen.findByRole("link", { name: "Choose Max" })).getAttribute("href")).toBe("/dashboard/settings/billing?upgrade=max");
		expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/dashboard");
	});

	it("says on sign-up which plan was picked, also on Clerk's later steps, and nothing when none was", async () => {
		session.signedIn = false;
		renderAt("/sign-up");
		expect(await screen.findByRole("list", { name: "Sign-up, step 1 of 2" })).toBeTruthy();
		expect(screen.queryByText(/You picked/)).toBeNull();
		cleanup();

		renderAt("/sign-up?plan=pro");
		expect((await screen.findByText(/You picked/)).textContent).toBe("You picked Pro · $10 a month, paid only when you upgrade");
		cleanup();

		renderAt("/sign-up/verify-email-address");
		expect((await screen.findByText(/You picked/)).textContent).toContain("Pro");
	});

	it("keeps the plan through sign-up and onboarding, then highlights it without asking for payment", async () => {
		session.signedIn = true;
		renderAt("/sign-up?plan=pro");
		await waitFor(() => expect(sessionStorage.getItem("lucidhire:picked-plan")).toBe("pro"));
		cleanup();

		const router = renderAt("/onboarding");
		fireEvent.change(await screen.findByLabelText("Company name"), { target: { value: "Sprite Labs" } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));

		const card = await screen.findByRole("listitem", { name: "Pro plan" }, { timeout: 5000 });
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
		expect(card.textContent).toContain("You picked Pro");
		expect(within(card).getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/billing/checkout"), expect.anything());
		expect(sessionStorage.getItem("lucidhire:picked-plan")).toBeNull();
	});

	it("goes to the jobs as before when no plan was picked", async () => {
		const router = renderAt("/onboarding");
		fireEvent.change(await screen.findByLabelText("Company name"), { target: { value: "Sprite Labs" } });
		fireEvent.click(screen.getByRole("button", { name: /Continue to your dashboard/ }));
		expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
	});
});

describe("plan limits", () => {
	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
	});

	it("shows how many of the month's jobs are used on the new job page", async () => {
		jobsUsed = 3;
		renderAt("/dashboard/jobs/new");
		// The sidebar has its own; this is the one in the Publish card.
		const meter = await within(await screen.findByRole("region", { name: "Publish" })).findByRole("meter", { name: "Jobs this month" });
		expect(meter.getAttribute("aria-valuetext")).toBe("3 of 10");
		expect(screen.queryByText(/You've used all/)).toBeNull();
		expect(screen.getByRole("button", { name: /Open job/ }).hasAttribute("disabled")).toBe(false);
	});

	it("warns on the meter when the month's jobs are nearly used up", async () => {
		jobsUsed = 9;
		renderAt("/dashboard/jobs/new");
		// The sidebar has its own; this is the one in the Publish card.
		const meter = await within(await screen.findByRole("region", { name: "Publish" })).findByRole("meter", { name: "Jobs this month" });
		expect(meter.getAttribute("aria-valuetext")).toBe("9 of 10. Almost at the limit");
		expect(screen.getByRole("button", { name: /Open job/ }).hasAttribute("disabled")).toBe(false);
	});

	it("says Unlimited on a plan with no job limit", async () => {
		jobsUsed = 25;
		jobsLimit = null;
		renderAt("/dashboard/jobs/new");
		expect(await screen.findByText(/Unlimited jobs on your plan · 25 created this month/)).toBeTruthy();
	});

	it("blocks a new job once the month's jobs are used up, and offers an upgrade to admins", async () => {
		jobsUsed = 10;
		renderAt("/dashboard/jobs/new");
		const banner = await screen.findByRole("alert");
		expect(banner.textContent).toContain("You've used all 10 new jobs this month. Deleting a job does not give the slot back.");
		expect(within(banner).getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/dashboard/settings/billing");
		expect(screen.getByRole("button", { name: /Open job/ }).hasAttribute("disabled")).toBe(true);
		// A draft counts towards the month's jobs too, and Ctrl+Enter doesn't get round the limit.
		fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
		expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "iOS Engineer" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "swift" } });
		fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter", ctrlKey: true });
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
	});

	it("tells a member to ask an admin instead", async () => {
		org = { id: "org_1", name: "Sprite Labs", role: "member" };
		jobsUsed = 10;
		renderAt("/dashboard/jobs/new");
		const banner = await screen.findByRole("alert");
		expect(within(banner).queryByRole("link", { name: "Upgrade" })).toBeNull();
		expect(within(banner).getByText("Ask an admin to upgrade.")).toBeTruthy();
	});

	it("shows the API's refusal as the same banner when the page's count was out of date", async () => {
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			new URL(url).pathname === "/jobs" && init?.method === "POST"
				? Promise.resolve(
						apiError(403, "plan_limit", "You've used all 10 new jobs this month. Deleting a job does not give the slot back."),
					)
				: answer(url, init),
		);
		renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Job title"), { target: { value: "Sprite limit role" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Swift." } });
		fireEvent.click(screen.getByRole("button", { name: /Open job/ }));

		const banner = await screen.findByRole("alert");
		expect(banner.textContent).toContain("You've used all 10 new jobs this month.");
		expect(within(banner).getByRole("link", { name: "Upgrade" })).toBeTruthy();
	});

	it("offers an upgrade when Improve with AI runs out", async () => {
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			new URL(url).pathname === "/jobs/enhance"
				? Promise.resolve(
						apiError(429, "plan_limit", "You've used all 30 AI requests for this hour. They reset at the top of the hour."),
					)
				: answer(url, init),
		);
		renderAt("/dashboard/jobs/new");
		fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "rough notes" } });
		fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));

		const message = await screen.findByText(/You've used all 30 AI requests for this hour/);
		expect(within(message.parentElement!).getByRole("link", { name: "Upgrade" })).toBeTruthy();
	});

	describe("CV uploads", () => {
		const fullJob = (cvCount: number): FakeJob => ({
			id: "job_1",
			title: "Senior iOS Engineer",
			description: "Swift.",
			status: "open",
			cvCount,
			createdAt: "2026-10-22T12:00:00Z",
			updatedAt: "2026-10-22T12:00:00Z",
		});

		it("gives an admin an Upgrade link when the job is full", async () => {
			jobs = [fullJob(10)];
			renderAt("/dashboard/jobs/job_1");
			expect(await screen.findByText("This job has used its 10 free CVs.")).toBeTruthy();
			// The page's link; the sidebar has its own on the Free plan.
			expect(within(screen.getByRole("main")).getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/dashboard/settings/billing");
		});

		it("tells a member to ask an admin", async () => {
			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			jobs = [fullJob(10)];
			renderAt("/dashboard/jobs/job_1");
			expect(await screen.findByText("This job has used its 10 free CVs.")).toBeTruthy();
			expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
			expect(screen.getByText("Ask an admin to upgrade.")).toBeTruthy();
		});

		it("words the limit for a paid plan without 'free'", async () => {
			cvLimit = 100;
			jobs = [fullJob(100)];
			renderAt("/dashboard/jobs/job_1");
			expect(await screen.findByText("100 of 100 CVs used")).toBeTruthy();
			expect(screen.getByText("This job has used its 100 CVs.")).toBeTruthy();
		});

		it("has nothing to upgrade to on the top plan", async () => {
			cvLimit = 1000;
			jobs = [fullJob(1000)];
			renderAt("/dashboard/jobs/job_1");
			expect(await screen.findByText("This job has used its 1,000 CVs.")).toBeTruthy();
			expect(within(screen.getByRole("main")).queryByRole("link", { name: "Upgrade" })).toBeNull();
		});
	});
});

// Changes the job's status from the job page's status menu ("Open ▾" › Close job).
async function chooseStatus(action: RegExp) {
	fireEvent.click(await within(await screen.findByRole("main")).findByRole("button", { name: /^Status: / }));
	fireEvent.click(await screen.findByRole("menuitem", { name: action }));
}

// Picks an item from the job page's overflow menu.
async function chooseMore(name: string | RegExp) {
	fireEvent.click(await within(await screen.findByRole("main")).findByRole("button", { name: "More actions" }));
	fireEvent.click(await screen.findByRole("menuitem", { name }));
}

describe("candidates", () => {
	const openJob = (fields: Partial<FakeJob> = {}): FakeJob => ({
		id: "job_1",
		title: "Senior iOS Engineer",
		description: "Swift, SwiftUI, 5 years.",
		status: "open",
		cvCount: 0,
		createdAt: "2026-10-22T12:00:00Z",
		updatedAt: "2026-10-22T12:00:00Z",
		...fields,
	});
	const pdf = (name: string, bytes = 1000) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
	// The uploads the page has sent so far.
	const uploads = () =>
		fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && url.includes("/candidates?"));
	// Chooses PDFs; they go up at once unless "Add a name or email to each CV" is on.
	const sendPdfs = async (input: HTMLElement, files: File[]) => {
		fireEvent.change(input, { target: { files } });
	};
	// Opens the upload drawer from the header's "Upload CVs", and gives back what is in it.
	const openUploads = async () => {
		const main = within(await screen.findByRole("main"));
		fireEvent.click((await main.findAllByRole("button", { name: "Upload CVs" }))[0]);
		return within(await screen.findByRole("dialog", { name: "Upload CVs" }));
	};
	// The drawer's file input, named by its "Choose PDFs" button.
	const chooser = async () => (await openUploads()).getByLabelText("Choose PDFs");
	// The ranked rows, in the order they are shown.
	const rowTexts = () =>
		within(screen.getByRole("list", { name: "Candidates" }))
			.getAllByRole("link")
			.map((link) => link.textContent);

	const isListGet = (url: string, init?: RequestInit) =>
		url.endsWith("/jobs/job_1/candidates") && init?.method === "GET";
	const isUpload = (url: string, init?: RequestInit) => init?.method === "POST" && url.includes("/candidates?");
	const isRetry = (url: string, init?: RequestInit) => init?.method === "POST" && url.endsWith("/retry");

	const grace = (fields: Partial<FakeCandidate> = {}) =>
		fakeCandidate({
			id: "cand_grace",
			fileName: "grace_turner.pdf",
			name: "Grace Turner",
			headline: "Senior iOS Engineer · London",
			score: 93,
			matches: ["SwiftUI", "Instruments"],
			gaps: ["Kotlin MP"],
			summary: "Six years of SwiftUI at a bank. No Kotlin shown.",
			scoredAt: "2026-10-22T12:05:00Z",
			evidence: [
				{ id: "r1", label: "Kotlin MP", detail: "Kotlin Multiplatform", weight: "must", level: "none", quote: "" },
				{
					id: "r2",
					label: "SwiftUI",
					detail: "Shipped SwiftUI apps",
					weight: "must",
					level: "clear",
					quote: "Built the SwiftUI app used by 2M customers",
				},
				{
					id: "r3",
					label: "Instruments",
					detail: "Profiling with Instruments",
					weight: "nice",
					level: "clear",
					quote: "Cut launch time 40% using Instruments",
				},
				{ id: "r4", label: "Accessibility", detail: "Accessibility work", weight: "nice", level: "none", quote: "" },
			],
			...fields,
		});

	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
		jobs = [openJob()];
	});

	it("uploads two PDFs to an open job, and they appear in the list", async () => {
		renderAt("/dashboard/jobs/job_1");

		const input = (await chooser()) as HTMLInputElement;
		expect(input.type).toBe("file");
		expect(input.accept).toBe("application/pdf");
		expect(input.multiple).toBe(true);
		expect(await screen.findByText("0 of 10 free CVs used")).toBeTruthy();

		const files = [pdf("grace_turner.pdf"), pdf("kenji tanaka.pdf")];
		await sendPdfs(input, files);

		expect(await screen.findByText("2 CVs uploaded")).toBeTruthy();
		expect(screen.getByText("2 of 10 free CVs used")).toBeTruthy();
		const list = screen.getByRole("list", { name: "Candidates" });
		expect(within(list).getByText("grace_turner.pdf")).toBeTruthy();
		expect(within(list).getByText("kenji tanaka.pdf")).toBeTruthy();
		expect(within(list).getAllByText("Reading the CV")).toHaveLength(2);

		// Each file went up on its own, as the raw body with the PDF type and its name in the query.
		expect(uploads().map(([url]) => url)).toEqual([
			"http://localhost:8787/jobs/job_1/candidates?fileName=grace_turner.pdf",
			"http://localhost:8787/jobs/job_1/candidates?fileName=kenji%20tanaka.pdf",
		]);
		const [, init] = uploads()[0];
		expect(init?.body).toBe(files[0]);
		expect(init?.headers).toEqual({ "Content-Type": "application/pdf", Authorization: "Bearer session-token" });
	});

	it("shows how far each upload has got, in a bar and in percent", async () => {
		uploadProgress = [10, 42];
		renderAt("/dashboard/jobs/job_1");
		const sending = hold(isUpload);

		await sendPdfs(await chooser(), [pdf("grace_turner.pdf")]);

		const bar = await screen.findByRole("progressbar", { name: "Uploading grace_turner.pdf" });
		expect(bar.getAttribute("aria-valuenow")).toBe("42");
		expect(bar.getAttribute("aria-valuemin")).toBe("0");
		expect(bar.getAttribute("aria-valuemax")).toBe("100");
		expect(screen.getByText("42%")).toBeTruthy();
		await act(async () => sending.release());
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(screen.queryByRole("progressbar")).toBeNull();
	});

	it("uploads three files at a time and keeps the list in the order they were chosen", async () => {
		renderAt("/dashboard/jobs/job_1");
		const sending = hold(isUpload);
		const names = ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"];
		await sendPdfs(await chooser(), names.map((name) => pdf(name)));

		await waitFor(() => expect(sending.pending()).toBe(3));
		expect(screen.getByText("Uploading 5 files")).toBeTruthy();
		expect(screen.getAllByRole("progressbar")).toHaveLength(3);
		expect(screen.getAllByText("Waiting")).toHaveLength(2);
		await act(async () => sending.release());
		// The two that were waiting go next.
		await waitFor(() => expect(sending.pending()).toBe(2));
		await act(async () => sending.release());

		expect(await screen.findByText("5 CVs uploaded")).toBeTruthy();
		expect(uploads().map(([url]) => decodeURIComponent(url.split("fileName=")[1]))).toEqual(names);
		expect(screen.getByText("5 of 10 free CVs used")).toBeTruthy();
	});

	it("takes a waiting file out of the batch before it uploads", async () => {
		renderAt("/dashboard/jobs/job_1");
		const sending = hold(isUpload);
		await sendPdfs(await chooser(), ["a", "b", "c", "d", "e"].map((name) => pdf(`${name}.pdf`)));

		// Three are on their way; the other two wait and can be removed.
		await waitFor(() => expect(sending.pending()).toBe(3));
		expect(screen.queryByRole("button", { name: "Remove a.pdf" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Remove d.pdf" }));
		expect(screen.queryByText("d.pdf")).toBeNull();
		await act(async () => sending.release());
		// The last one goes next, held the same way.
		await waitFor(() => expect(sending.pending()).toBe(1));
		await act(async () => sending.release());

		expect(await screen.findByText("4 CVs uploaded")).toBeTruthy();
		expect(uploads().map(([url]) => decodeURIComponent(url.split("fileName=")[1]))).toEqual(["a.pdf", "b.pdf", "c.pdf", "e.pdf"]);
		expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
		expect(screen.getByText("4 of 10 free CVs used")).toBeTruthy();
	});

	it("offers Retry upload for a file that failed to go up, and not for one the API refused", async () => {
		renderAt("/dashboard/jobs/job_1");
		const answer = fetchMock.getMockImplementation()!;
		let failures = 1;
		fetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (isUpload(url, init) && failures-- > 0) return Promise.reject(new TypeError("Failed to fetch"));
			return answer(url, init);
		});

		await sendPdfs(await chooser(), [pdf("flaky.pdf")]);
		expect(await screen.findByText("✕ We couldn't reach LucidHire. Check your connection and try again.")).toBeTruthy();
		expect(screen.getByText("1 not uploaded")).toBeTruthy();
		expect(screen.getByText("0 of 10 free CVs used")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Retry upload flaky.pdf" }));
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Retry upload/ })).toBeNull();
		expect(screen.queryByText(/We couldn't reach/)).toBeNull();
		expect(uploads()).toHaveLength(2);
		expect(screen.getByText("1 of 10 free CVs used")).toBeTruthy();

		// A server error can be retried too; a 4xx is the file's own problem.
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			isUpload(url, init) ? Promise.resolve(apiError(502, "upload_failed", "We couldn't store that file. Try again.")) : answer(url, init),
		);
		await sendPdfs(screen.getByLabelText("Choose PDFs"), [pdf("later.pdf")]);
		expect(await screen.findByText("✕ We couldn't store that file. Try again.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry upload later.pdf" })).toBeTruthy();

		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			isUpload(url, init) ? Promise.resolve(apiError(400, "not_pdf", "Upload a PDF file")) : answer(url, init),
		);
		await sendPdfs(screen.getByLabelText("Choose PDFs"), [pdf("fake.pdf")]);
		expect(await screen.findByText("✕ Upload a PDF file")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Retry upload/ })).toBeNull();
	});

	it("says when every CV has been read, and not before or when nothing was being read", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_grace", fileName: "grace_turner.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1");

		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByText("All CVs processed. The list is up to date.")).toBeNull();

		Object.assign(candidates[0], grace());
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		const done = await screen.findByText("All CVs processed. The list is up to date.");
		// A live region that was already on the page, so it is read out.
		expect(done.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
		cleanup();

		// Opening a job whose CVs are all read says nothing.
		candidates = [grace()];
		renderAt("/dashboard/jobs/job_1");
		await screen.findByText("Grace Turner");
		expect(screen.queryByText("All CVs processed. The list is up to date.")).toBeNull();
	});

	it("calls the upload zone Add CVs on a phone, and keeps the Choose PDFs button", async () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query === "(pointer: coarse)",
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		renderAt("/dashboard/jobs/job_1");

		const drawer = await openUploads();
		expect(drawer.getByText("Add CVs")).toBeTruthy();
		expect(drawer.queryByText("Drop CVs here")).toBeNull();
		expect(drawer.getByLabelText("Choose PDFs")).toBeTruthy();
	});

	it("takes PDFs dropped on the zone", async () => {
		renderAt("/dashboard/jobs/job_1");

		const zone = (await openUploads()).getByText("Drop CVs here");
		// The page has to cancel dragover, or the browser opens the PDF itself.
		expect(fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } })).toBe(false);
		fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [pdf("dropped.pdf")] } });

		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(within(screen.getByRole("list", { name: "Candidates" })).getByText("dropped.pdf")).toBeTruthy();
	});

	describe("the name and email of each CV", () => {
		const stage = async (...names: string[]) => {
			renderAt("/dashboard/jobs/job_1");
			fireEvent.click((await openUploads()).getByLabelText("Add a name or email to each CV"));
			fireEvent.change(screen.getByLabelText("Choose PDFs"), { target: { files: names.map((name) => pdf(name)) } });
			return screen.findByText(`${names.length} ${names.length === 1 ? "CV" : "CVs"} ready to upload`);
		};
		const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

		it("is off by default, so chosen files upload at once", async () => {
			renderAt("/dashboard/jobs/job_1");
			const toggle = (await openUploads()).getByLabelText("Add a name or email to each CV") as HTMLInputElement;
			expect(toggle.type).toBe("checkbox");
			expect(toggle.checked).toBe(false);
			fireEvent.change(screen.getByLabelText("Choose PDFs"), { target: { files: [pdf("now.pdf")] } });
			expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
			expect(screen.queryByLabelText(/^Name for /)).toBeNull();
		});

		it("keeps staged files, and their Upload button, when it is turned off", async () => {
			await stage("held.pdf");
			fireEvent.click(screen.getByLabelText("Add a name or email to each CV"));
			expect(uploads()).toHaveLength(0);
			// Files chosen now go straight up; the held one waits for its button.
			fireEvent.change(screen.getByLabelText("Choose PDFs"), { target: { files: [pdf("direct.pdf")] } });
			await waitFor(() => expect(uploads()).toHaveLength(1));
			fireEvent.click(await screen.findByRole("button", { name: "Upload 1 CV" }));
			await waitFor(() => expect(uploads()).toHaveLength(2));
		});

		it("holds the chosen files until Upload, with a labelled name and email for each", async () => {
			await stage("grace_turner.pdf", "kenji tanaka.pdf");

			expect(uploads()).toHaveLength(0);
			for (const file of ["grace_turner.pdf", "kenji tanaka.pdf"]) {
				for (const field of ["Name", "Email"]) {
					const input = screen.getByLabelText(`${field} for ${file}`) as HTMLInputElement;
					expect(input.placeholder).toBe("Read from the CV");
					expect(input.value).toBe("");
				}
			}
			expect(screen.getByRole("button", { name: "Upload 2 CVs" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Remove kenji tanaka.pdf" }));
			expect(screen.getByRole("button", { name: "Upload 1 CV" })).toBeTruthy();
		});

		it("sends what was typed in headers, and nothing for a blank field", async () => {
			await stage("grace_turner.pdf", "kenji tanaka.pdf");
			type("Name for grace_turner.pdf", "  Zoë Müller ");
			type("Email for grace_turner.pdf", " Zoe@Example.com ");
			fireEvent.click(screen.getByRole("button", { name: "Upload 2 CVs" }));

			expect(await screen.findByText("2 CVs uploaded")).toBeTruthy();
			const [first, second] = uploads().map(([, init]) => init?.headers);
			expect(first).toEqual({
				"Content-Type": "application/pdf",
				Authorization: "Bearer session-token",
				"X-Applicant-Name": encodeURIComponent("Zoë Müller"),
				"X-Applicant-Email": "Zoe@Example.com",
			});
			expect(second).toEqual({ "Content-Type": "application/pdf", Authorization: "Bearer session-token" });
			// The fields give way to the results.
			expect(screen.queryByLabelText(/^Name for /)).toBeNull();
		});

		it("holds the upload back for a malformed or repeated email, on the row that has it", async () => {
			await stage("grace_turner.pdf", "kenji tanaka.pdf", "ada.pdf");
			type("Email for grace_turner.pdf", "not-an-email");
			type("Email for kenji tanaka.pdf", "Ada@example.com");
			type("Email for ada.pdf", "ada@EXAMPLE.com");
			fireEvent.click(screen.getByRole("button", { name: "Upload 3 CVs" }));

			const alerts = await screen.findAllByRole("alert");
			expect(alerts.map((alert) => alert.textContent)).toEqual([
				"✕ Enter a valid email address",
				"✕ Another file in this batch has this email address",
			]);
			expect(screen.getByLabelText("Email for grace_turner.pdf").getAttribute("aria-invalid")).toBe("true");
			expect(screen.getByLabelText("Email for kenji tanaka.pdf").getAttribute("aria-invalid")).toBeNull();
			expect(uploads()).toHaveLength(0);

			// Fixing the rows lets the batch go.
			type("Email for grace_turner.pdf", "");
			type("Email for ada.pdf", "other@example.com");
			expect(screen.queryByRole("alert")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Upload 3 CVs" }));
			expect(await screen.findByText("3 CVs uploaded")).toBeTruthy();
		});

		it("shows the API's answer when the email is already on another CV of the job", async () => {
			await stage("grace_turner.pdf");
			const answer = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				isUpload(url, init)
					? Promise.resolve(apiError(409, "email_taken", "Another CV on this job already uses that email address"))
					: answer(url, init),
			);
			type("Email for grace_turner.pdf", "grace@example.com");
			fireEvent.click(screen.getByRole("button", { name: "Upload 1 CV" }));

			expect(await screen.findByText("✕ Another CV on this job already uses that email address")).toBeTruthy();
			expect(screen.queryByRole("button", { name: /Retry upload/ })).toBeNull();
		});
	});

	it("turns away a file that is not a PDF, is empty or is over 5 MB, without sending it", async () => {
		renderAt("/dashboard/jobs/job_1");

		fireEvent.change(await chooser(), {
			target: {
				files: [
					new File(["notes"], "notes.txt", { type: "text/plain" }),
					pdf("huge.pdf", CV_MAX_BYTES + 1),
					pdf("empty.pdf", 0),
				],
			},
		});

		expect(await screen.findByText("3 not uploaded")).toBeTruthy();
		expect(screen.getByText("✕ Upload a PDF file")).toBeTruthy();
		expect(screen.getByText("✕ Each CV must be 5 MB or smaller")).toBeTruthy();
		expect(screen.getByText("✕ That file is empty")).toBeTruthy();
		expect(uploads()).toHaveLength(0);
	});

	it("stops at the job's 10 free CVs, and turns the extra files away without sending them", async () => {
		jobs = [openJob({ cvCount: 9 })];
		renderAt("/dashboard/jobs/job_1");

		const input = await chooser();
		await sendPdfs(input, [pdf("ninth.pdf"), pdf("tenth.pdf")]);

		expect(await screen.findByText("1 uploaded · 1 not uploaded")).toBeTruthy();
		expect(screen.getByText("✕ This job has used its 10 free CVs")).toBeTruthy();
		expect(screen.getByText("10 of 10 free CVs used")).toBeTruthy();
		expect(uploads()).toHaveLength(1);
		// Nothing left to take, so the chooser gives way to a note, in the drawer and above the list.
		const drawer = within(screen.getByRole("dialog", { name: "Upload CVs" }));
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(drawer.getByText("This job has used its 10 free CVs.")).toBeTruthy();
		expect(within(screen.getByRole("region", { name: "Candidates" })).getByText("This job has used its 10 free CVs.")).toBeTruthy();
		fireEvent.click(drawer.getByRole("button", { name: "Clear list" }));
		expect(screen.queryByText("1 uploaded · 1 not uploaded")).toBeNull();
		// There is no chooser to go to, so focus lands on the note.
		expect(document.activeElement).toBe(drawer.getByText("This job has used its 10 free CVs."));
	});

	it("moves focus to Choose PDFs when the results are cleared", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = await chooser();
		fireEvent.change(input, { target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] } });

		const clear = await screen.findByRole("button", { name: "Clear list" });
		clear.focus();
		fireEvent.click(clear);

		expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
		expect(document.activeElement).toBe(input);
	});

	it("offers Upload CVs and the apply link while a job has no CVs, until one goes up", async () => {
		const writeText = vi.fn(async (_text: string) => {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		renderAt("/dashboard/jobs/job_1");

		const empty = within(await screen.findByRole("region", { name: "Candidates" }));
		expect(await empty.findByRole("heading", { name: "No CVs yet" })).toBeTruthy();
		expect(empty.getByRole("button", { name: "Upload CVs" })).toBeTruthy();
		fireEvent.click(empty.getByRole("button", { name: "Copy apply link" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://lucidhire.io/jobs/job_1-slug"));
		expect(await screen.findByText("Apply link copied")).toBeTruthy();

		await sendPdfs(await chooser(), [pdf("one.pdf")]);
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "No CVs yet" })).toBeNull();
	});

	it("shows the API's reason when it refuses a file, and doesn't send the rest of the batch", async () => {
		jobs = [openJob({ cvCount: 6 })];
		renderAt("/dashboard/jobs/job_1");
		const input = await chooser();
		// Someone else used the last slots since this page loaded, so only the server knows.
		jobs[0].cvCount = 10;
		await sendPdfs(input, [pdf("first.pdf"), pdf("second.pdf"), pdf("third.pdf"), pdf("fourth.pdf")]);

		expect(await screen.findByText("4 not uploaded")).toBeTruthy();
		expect(screen.getAllByText("✕ This job has used its 10 free CVs")).toHaveLength(4);
		// The first three were already on their way; the fourth is not sent.
		expect(uploads()).toHaveLength(3);
		// The page catches up with the server: the count is right and the chooser is gone.
		expect(await screen.findByText("10 of 10 free CVs used")).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(within(screen.getByRole("dialog", { name: "Upload CVs" })).getByText("This job has used its 10 free CVs.")).toBeTruthy();
	});

	it("learns that a job was closed when the API refuses a CV, and keeps the result on screen", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = await chooser();
		jobs[0].status = "closed";
		await sendPdfs(input, [pdf("late.pdf"), pdf("later.pdf"), pdf("latest.pdf"), pdf("last.pdf")]);

		expect(await screen.findByText("4 not uploaded")).toBeTruthy();
		expect(screen.getAllByText("✕ This job isn't open, so it can't take CVs. Open it first.")).toHaveLength(4);
		expect(uploads()).toHaveLength(3);
		// The job is read again, so the page now shows it closed instead of offering the zone.
		const drawer = within(screen.getByRole("dialog", { name: "Upload CVs" }));
		expect(await drawer.findByText(/This job is closed, so it can't take new CVs/)).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(drawer.getByText("late.pdf")).toBeTruthy();
	});

	it("keeps the file input usable while uploading, and ignores files chosen meanwhile", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = (await chooser()) as HTMLInputElement;
		const uploading = hold(isUpload);
		await sendPdfs(input, [pdf("one.pdf")]);

		await waitFor(() => expect(uploading.pending()).toBe(1));
		// Disabling it would drop the keyboard focus, so it only looks busy.
		expect(input.disabled).toBe(false);
		expect(screen.getByText("Uploading 1 file")).toBeTruthy();
		fireEvent.change(input, { target: { files: [pdf("two.pdf")] } });
		expect(uploads()).toHaveLength(1);

		await act(async () => uploading.release());
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(uploads()).toHaveLength(1);
	});

	it("keeps a CV that just went up in the list when an older list answer arrives late", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_old", fileName: "reading.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1");
		await screen.findByText("Reading the CV");

		// A poll goes out and its answer is held. It was taken before the upload below.
		const lists = hold(isListGet);
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		expect(lists.pending()).toBe(1);
		const uploading = hold(isUpload);
		await sendPdfs(await chooser(), [pdf("fresh.pdf")]);
		await waitFor(() => expect(uploading.pending()).toBe(1));
		await act(async () => uploading.release());
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();

		// First file is in. The old answer now lands, and must not wipe it from the list.
		await act(async () => lists.release());
		await act(() => vi.advanceTimersByTimeAsync(100));
		expect(within(screen.getByRole("list", { name: "Candidates" })).getByText("fresh.pdf")).toBeTruthy();
	});

	it("says why a job that is not open can't take CVs, with the button that opens it", async () => {
		jobs = [openJob({ id: "job_1", status: "draft" }), openJob({ id: "job_2", status: "closed" })];

		renderAt("/dashboard/jobs/job_1");
		const section = within(await screen.findByRole("region", { name: "Candidates" }));
		expect(await section.findByText(/This job is a draft, so it can't take CVs yet/)).toBeTruthy();
		// The drawer says the same in place of the chooser.
		const drawer = await openUploads();
		expect(drawer.getByText(/This job is a draft/)).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(screen.queryByText("Drop CVs here")).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/job_2");
		expect(await screen.findByText(/This job is closed, so it can't take new CVs/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reopen job" })).toBeTruthy();
		cleanup();

		// Opening the draft from the banner brings the chooser in.
		renderAt("/dashboard/jobs/job_1");
		fireEvent.click(await screen.findByRole("button", { name: "Open job" }));
		expect(await screen.findByText("Job opened")).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(/This job is a draft/)).toBeNull());
		expect(await chooser()).toBeTruthy();
	});

	it("ranks scored CVs best first, with yellow matches and pink gaps, then the ones still being read", async () => {
		jobs = [openJob({ cvCount: 4 })];
		candidates = [
			fakeCandidate({
				id: "cand_bad",
				fileName: "scan.pdf",
				status: "failed",
				error: "We couldn't read this file as a CV.",
			}),
			fakeCandidate({ id: "cand_new", fileName: "new_upload.pdf", status: "queued" }),
			fakeCandidate({
				id: "cand_kenji",
				name: "Kenji Tanaka",
				headline: "iOS Developer · Tokyo",
				score: 71,
				matches: ["SwiftUI"],
			}),
			grace(),
		];
		renderAt("/dashboard/jobs/job_1");

		expect(await screen.findByText("4 of 10 free CVs used")).toBeTruthy();
		await screen.findByText("Grace Turner");
		const rows = rowTexts();
		expect(rows).toEqual([
			expect.stringMatching(/Grace Turner.*Senior iOS Engineer · London.*93/),
			expect.stringMatching(/Kenji Tanaka.*iOS Developer · Tokyo.*71/),
			expect.stringMatching(/new_upload\.pdf.*Reading the CV/),
			expect.stringMatching(/scan\.pdf.*✕ We couldn't read this file as a CV\./),
		]);

		// Only the best match sits on the marker band. The ring belongs to the detail pane, not the list.
		const list = screen.getByRole("list", { name: "Candidates" });
		const items = within(list).getAllByRole("listitem");
		expect(items[0].className).toContain("rank-band");
		expect(items[1].className).not.toContain("rank-band");
		expect(list.querySelector(".score-ring")).toBeNull();
		const links = within(list).getAllByRole("link");
		expect(links[0].getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/cand_grace");

		// Matches are yellow marks; a gap is a pink mark with a ✕, and both are words.
		expect(screen.getAllByText("SwiftUI").every((tag) => tag.className.includes("mk"))).toBe(true);
		expect(screen.getByText("Instruments").className).not.toContain("mk-gap");
		expect(screen.getByText("✕ Kotlin MP").className).toContain("mk-gap");
		expect(screen.getByText("2 of 4 read · 1 failed")).toBeTruthy();
	});

	it("keeps asking while a CV is being read, and stops once every CV is done", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_grace", fileName: "grace_turner.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1");

		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.getByText("0 of 1 read")).toBeTruthy();
		const asked = () =>
			fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/jobs/job_1/candidates") && init?.method === "GET")
				.length;
		expect(asked()).toBe(1);

		// The Workflow finishes between two polls.
		Object.assign(candidates[0], grace());
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));

		expect(await screen.findByText("Grace Turner")).toBeTruthy();
		expect(screen.getByText("1 of 1 read")).toBeTruthy();
		expect(screen.queryByText("Reading the CV")).toBeNull();
		expect(asked()).toBe(2);

		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS * 4));
		expect(asked()).toBe(2);
	});

	it("keeps the candidate page up to date while its CV is being read", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_grace", fileName: "grace_turner.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

		// Until it is read, the page is named after the file and says what is happening.
		expect(await screen.findByRole("heading", { level: 1, name: "grace_turner.pdf" })).toBeTruthy();
		const main = within(screen.getByRole("main"));
		expect(main.getByRole("status").textContent).toBe("Reading the CV");
		expect(main.getByText("The evidence shows here once the CV is read.")).toBeTruthy();
		expect(main.queryByRole("region", { name: "Must-haves" })).toBeNull();

		Object.assign(candidates[0], grace());
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));

		expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
		expect(document.title).toBe("Grace Turner · LucidHire");
		// The score takes the reading pill's place in the same status region, so the change is read out.
		expect(main.getByRole("status").textContent).toBe("Score 93· 2 of 4 requirements met");
		expect(main.getByRole("region", { name: "Must-haves" })).toBeTruthy();
	});

	it("opens a candidate with the evidence for each requirement, must-haves first", async () => {
		candidates = [grace()];
		renderAt("/dashboard/jobs/job_1/candidates/cand_grace?show=review&q=grace");

		expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
		const main = within(screen.getByRole("main"));
		expect(document.title).toBe("Grace Turner · LucidHire");
		expect(main.getByText("Senior iOS Engineer · London")).toBeTruthy();
		expect(main.getByText("Six years of SwiftUI at a bank. No Kotlin shown.")).toBeTruthy();
		expect(main.getByRole("status").textContent).toBe("Score 93· 2 of 4 requirements met");
		expect(main.getByText("Ranked #1 of 1")).toBeTruthy();
		expect(main.getByText("Must-haves 1 of 2 · Nice to have 1 of 2")).toBeTruthy();
		const file = main.getByRole("region", { name: "CV file" });
		expect(within(file).getByText("grace_turner.pdf")).toBeTruthy();
		expect(within(file).getByText("117 KB")).toBeTruthy();

		// The way back keeps the job page's filter and search.
		const crumbs = within(main.getByRole("navigation", { name: "Breadcrumb" }));
		expect(crumbs.getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe("/dashboard/jobs");
		expect(crumbs.getByRole("link", { name: "Senior iOS Engineer" }).getAttribute("href")).toBe(
			"/dashboard/jobs/job_1?show=review&q=grace",
		);
		expect(crumbs.getByText("Grace Turner").getAttribute("aria-current")).toBe("page");

		const must = main.getByRole("region", { name: "Must-haves" });
		const nice = main.getByRole("region", { name: "Nice to have" });
		expect(must.compareDocumentPosition(nice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		// Met: a yellow label and the line from the CV.
		const swiftUi = within(must).getByText("SwiftUI");
		expect(swiftUi.className).toContain("mk");
		expect(swiftUi.className).not.toContain("mk-gap");
		expect(within(must).getByText("“Built the SwiftUI app used by 2M customers”")).toBeTruthy();
		expect(within(nice).getByText("“Cut launch time 40% using Instruments”")).toBeTruthy();
		// Not met: a pink label with a ✕, and no quote to show.
		expect(within(must).getByText("✕ Kotlin MP").className).toContain("mk-gap");
		expect(within(must).getByText("Not shown in the CV")).toBeTruthy();
		expect(within(nice).getByText("✕ Accessibility").className).toContain("mk-gap");
		expect(within(nice).getByText("Not shown in the CV")).toBeTruthy();
	});

	it("retries a CV that failed, from the job page and the candidate page", async () => {
		candidates = [
			fakeCandidate({
				id: "cand_bad",
				fileName: "scan.pdf",
				status: "failed",
				error: "Scoring failed. Try again.",
				canRetry: true,
				createdAt: "2026-10-22T12:30:00Z",
			}),
			fakeCandidate({
				id: "cand_dead",
				fileName: "broken.pdf",
				status: "failed",
				error: "We couldn't read this file as a CV.",
			}),
		];
		renderAt("/dashboard/jobs/job_1");

		// Only the CV with runs left can be retried. Both failed, so they keep the order they were uploaded in.
		expect(await screen.findAllByText(/✕ /)).toHaveLength(2);
		expect(rowTexts()).toEqual([expect.stringContaining("broken.pdf"), expect.stringContaining("scan.pdf")]);
		expect(screen.getAllByRole("button", { name: "Retry scan.pdf" })).toHaveLength(1);
		// The refetch after the retry is held, so the order can only come from the page itself.
		hold(isListGet);
		fireEvent.click(screen.getByRole("button", { name: "Retry scan.pdf" }));

		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/jobs/job_1/candidates/cand_bad/retry",
			expect.objectContaining({ method: "POST" }),
		);
		// It is queued again, so it moves ahead of the CV that failed for good.
		expect(rowTexts()).toEqual([expect.stringContaining("scan.pdf"), expect.stringContaining("broken.pdf")]);
		cleanup();

		candidates[0].status = "failed";
		Object.assign(candidates[0], { error: "Scoring failed. Try again.", canRetry: true });
		renderAt("/dashboard/jobs/job_1/candidates/cand_bad");
		expect(await screen.findByText(/We couldn't score this CV/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByText(/We couldn't score this CV/)).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/job_1/candidates/cand_dead");
		expect(await screen.findByText(/We couldn't score this CV/)).toBeTruthy();
		expect(screen.getByText("We couldn't read this file as a CV.")).toBeTruthy();
		expect(screen.getByText("We've tried this CV 3 times. It may not be a readable PDF.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("says Try again on a failed CV only while it can be tried again", async () => {
		const failed = (id: string, fields: Partial<FakeCandidate>) =>
			fakeCandidate({
				id,
				fileName: `${id}.pdf`,
				status: "failed",
				error: "Scoring failed. Try again.",
				createdAt: "2026-10-22T12:00:00Z",
				...fields,
			});
		candidates = [failed("cand_more", { canRetry: true }), failed("cand_last", { createdAt: "2026-10-22T12:30:00Z" })];
		renderAt("/dashboard/jobs/job_1");

		expect(await screen.findByText("✕ Scoring failed. Try again.")).toBeTruthy();
		expect(screen.getByText("✕ Scoring failed.")).toBeTruthy();
		cleanup();

		renderAt("/dashboard/jobs/job_1/candidates/cand_last");
		expect(await screen.findByText("Scoring failed.")).toBeTruthy();
		expect(screen.getByText("We've tried this CV 3 times. It may not be a readable PDF.")).toBeTruthy();
		expect(screen.queryByText(/Try again/)).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/job_1/candidates/cand_more");
		expect(await screen.findByText("Scoring failed. Try again.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("keeps each row's retry state to itself", async () => {
		const failed = (id: string, createdAt: string) =>
			fakeCandidate({
				id,
				fileName: `${id}.pdf`,
				status: "failed",
				error: "Scoring failed. Try again.",
				canRetry: true,
				createdAt,
			});
		candidates = [failed("cand_a", "2026-10-22T12:00:00Z"), failed("cand_b", "2026-10-22T12:10:00Z")];
		renderAt("/dashboard/jobs/job_1");

		const retrying = hold(isRetry);
		fireEvent.click((await screen.findAllByRole("button", { name: /^Retry/ }))[0]);
		await waitFor(() => expect(retrying.pending()).toBe(1));

		const buttons = screen.getAllByRole("button", { name: /Retry/ });
		expect(buttons.map((button) => [button.textContent, button.getAttribute("aria-label")])).toEqual([
			["Retrying", "Retrying cand_a.pdf"],
			["Retry", "Retry cand_b.pdf"],
		]);
		// The busy one only looks disabled: it keeps focus, and a second click sends nothing.
		expect(buttons.map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "false"]);
		expect(buttons.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false]);
		buttons[0].focus();
		fireEvent.click(buttons[0]);
		expect(document.activeElement).toBe(buttons[0]);
		expect(retrying.pending()).toBe(1);
		await act(async () => retrying.release());
	});

	it("offers Retry on a CV stuck in the queue, beside the note that it is taking longer than usual", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-22T12:30:00Z"), shouldAdvanceTime: true });
		const reading = (id: string, createdAt: string, fields: Partial<FakeCandidate> = {}) =>
			fakeCandidate({ id, fileName: `${id}.pdf`, status: "scoring", createdAt, ...fields });
		candidates = [
			reading("cand_stuck", "2026-10-22T12:00:00Z", { canRetry: true }),
			reading("cand_slow", "2026-10-22T12:24:00Z"),
			reading("cand_fresh", "2026-10-22T12:29:00Z"),
		];
		renderAt("/dashboard/jobs/job_1");

		// Over 5 minutes is slow; the API allows a retry once it has been stuck much longer.
		expect(await screen.findAllByText("Reading the CV")).toHaveLength(3);
		expect(screen.getAllByText("This is taking longer than usual.")).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: "Retry cand_stuck.pdf" })).toHaveLength(1);
		const stuck = screen.getByRole("link", { name: /cand_stuck\.pdf/ }).closest("li")!;
		expect(within(stuck).getByText("This is taking longer than usual.")).toBeTruthy();
		expect(within(stuck).getByRole("button", { name: "Retry cand_stuck.pdf" })).toBeTruthy();

		// Retrying starts the clock again, which only the API's updatedAt can say.
		fireEvent.click(within(stuck).getByRole("button", { name: "Retry cand_stuck.pdf" }));
		await waitFor(() => expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull());
		expect(within(stuck).queryByText("This is taking longer than usual.")).toBeNull();
		cleanup();

		// And the same on the candidate page.
		Object.assign(candidates[0], { status: "scoring", canRetry: true, updatedAt: undefined });
		renderAt("/dashboard/jobs/job_1/candidates/cand_stuck");
		expect(await screen.findByText("This is taking longer than usual.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
		expect(screen.queryByText("This is taking longer than usual.")).toBeNull();
		expect(screen.getByText("Reading the CV")).toBeTruthy();
	});

	it("starts saying a CV is taking longer than usual while the list stays open", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-22T12:30:00Z"), shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_slow", fileName: "slow.pdf", status: "scoring", createdAt: "2026-10-22T12:28:00Z" })];
		renderAt("/dashboard/jobs/job_1");

		// Two minutes in. Every poll brings the same answer, so only the clock can change what the row says.
		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByText("This is taking longer than usual.")).toBeNull();
		await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
		expect(screen.queryByText("This is taking longer than usual.")).toBeNull();

		// Past five minutes, within one tick.
		await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
		expect(screen.getByText("This is taking longer than usual.")).toBeTruthy();
	});

	it("starts saying it on the candidate page too, and stops the clock once the CV is read", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-22T12:30:00Z"), shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_slow", fileName: "slow.pdf", status: "scoring", createdAt: "2026-10-22T12:28:00Z" })];
		renderAt("/dashboard/jobs/job_1/candidates/cand_slow");

		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByText("This is taking longer than usual.")).toBeNull();
		await act(() => vi.advanceTimersByTimeAsync(4 * 60_000));
		expect(screen.getByText("This is taking longer than usual.")).toBeTruthy();

		Object.assign(candidates[0], grace({ id: "cand_slow" }));
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		expect(await screen.findByText("2 of 4 requirements met")).toBeTruthy();
		expect(screen.queryByText("This is taking longer than usual.")).toBeNull();
	});

	it("keeps the ranked list on screen when a poll fails, and recovers on the next one", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [grace(), fakeCandidate({ id: "cand_new", fileName: "new_upload.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1");
		await screen.findByText("Grace Turner");

		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			isListGet(url, init) ? Promise.resolve(apiError(503, "unavailable", "Try again later")) : answer(url, init),
		);
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));

		expect(await screen.findByText(/We couldn't refresh\. Retrying\./)).toBeTruthy();
		expect(screen.queryByText(/We couldn't load the candidates/)).toBeNull();
		expect(rowTexts()).toHaveLength(2);
		expect(screen.getByText("Grace Turner")).toBeTruthy();

		fetchMock.mockImplementation(answer);
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		await waitFor(() => expect(screen.queryByText(/couldn't refresh/)).toBeNull());
		expect(screen.getByText("Grace Turner")).toBeTruthy();
	});

	it("keeps the candidate page on screen when a poll fails, unless the candidate is gone", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_grace", fileName: "grace_turner.pdf", status: "scoring" })];
		renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
		expect(await screen.findByRole("heading", { level: 1, name: "grace_turner.pdf" })).toBeTruthy();

		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			url.endsWith("/candidates/cand_grace")
				? Promise.resolve(apiError(503, "unavailable", "Try again later"))
				: answer(url, init),
		);
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		expect(await screen.findByText(/We couldn't refresh\. Retrying\./)).toBeTruthy();
		expect(screen.getByRole("heading", { level: 1, name: "grace_turner.pdf" })).toBeTruthy();
		expect(screen.queryByText(/We couldn't load this candidate/)).toBeNull();

		// A 404 means someone deleted it, and the page says so instead of showing what it had.
		fetchMock.mockImplementation(answer);
		candidates = [];
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		expect(await screen.findByText(/This candidate doesn't exist/)).toBeTruthy();
	});

	it("lets an admin delete a candidate after confirming, and goes back to the job", async () => {
		jobs = [openJob({ cvCount: 2 })];
		candidates = [grace(), fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 })];
		const router = renderAt("/dashboard/jobs/job_1");

		fireEvent.click(await screen.findByRole("link", { name: /Grace Turner/ }));
		const open = await screen.findByRole("button", { name: "Delete candidate" });
		open.focus();
		fireEvent.click(open);
		const dialog = await screen.findByRole("alertdialog", { name: "Delete “Grace Turner”?" });
		expect(document.activeElement).toHaveProperty("textContent", "Cancel");

		// Tab stays inside the dialog, and Escape gives focus back to the button that opened it.
		const confirm = within(dialog).getByRole("button", { name: "Delete candidate" });
		confirm.focus();
		expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
		expect(document.activeElement).toHaveProperty("textContent", "Cancel");
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(document.activeElement).toBe(open);
		fireEvent.click(open);

		// Hold the list's refetch, so the job page can only show what the cache holds after the delete.
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			url.endsWith("/jobs/job_1/candidates") && init?.method === "GET" ? new Promise(() => {}) : answer(url, init),
		);
		fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete candidate" }));

		const deleted = await screen.findByText("Deleted “Grace Turner”");
		expect(deleted.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1");
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/jobs/job_1/candidates/cand_grace",
			expect.objectContaining({ method: "DELETE" }),
		);
		const list = await screen.findByRole("list", { name: "Candidates" });
		expect(within(list).queryByText("Grace Turner")).toBeNull();
		expect(within(list).getByText("Kenji Tanaka")).toBeTruthy();
		// The deleted CV still counts against the job's 10.
		expect(screen.getByText("2 of 10 free CVs used")).toBeTruthy();
	});

	it("doesn't ask for a candidate while it is being deleted", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		candidates = [fakeCandidate({ id: "cand_grace", fileName: "grace_turner.pdf", status: "scoring" })];
		const router = renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
		fireEvent.click(await screen.findByRole("button", { name: "Delete candidate" }));

		// The API deletes it, but its answer is slow. Polling in that gap would get "doesn't exist".
		const deleting = hold((_url, init) => init?.method === "DELETE");
		const asked = () => fetchMock.mock.calls.filter(([url]) => url.endsWith("/candidates/cand_grace")).length;
		const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete candidate" });
		confirm.focus();
		fireEvent.click(confirm);
		await waitFor(() => expect(deleting.pending()).toBe(1));
		// The buttons only look disabled, so focus stays in the dialog on the one that was pressed.
		expect(confirm.textContent).toBe("Deleting");
		expect(confirm.getAttribute("aria-disabled")).toBe("true");
		expect(document.activeElement).toBe(confirm);
		fireEvent.click(confirm);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(deleting.pending()).toBe(1);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		const before = asked();
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS * 3));
		expect(asked()).toBe(before);
		expect(screen.queryByText(/This candidate doesn't exist/)).toBeNull();

		await act(async () => deleting.release());
		expect(await screen.findByText("Deleted “grace_turner.pdf”")).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1");
	});

	it("says in the delete dialog that deleting a job removes its CVs", async () => {
		jobs = [openJob({ cvCount: 3 })];
		candidates = [grace(), fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 })];
		renderAt("/dashboard/jobs/job_1");

		await screen.findByText("Grace Turner");
		await chooseMore("Delete job");
		const dialog = await screen.findByRole("alertdialog", { name: "Delete “Senior iOS Engineer”?" });
		// The CVs still listed go with the job, not every CV ever uploaded to it.
		expect(dialog.textContent).toContain(
			"It and its 2 CVs are removed for everyone at Sprite Labs. You can't undo this.",
		);
	});

	it("hides candidate delete from members, and explains a candidate that doesn't exist", async () => {
		org = { id: "org_1", name: "Sprite Labs", role: "member" };
		candidates = [grace()];

		renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
		expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Delete candidate" })).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/job_1/candidates/missing");
		expect(await screen.findByText(/This candidate doesn't exist/)).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to the job" })).toBeTruthy();
	});

	it("shows how many CVs each job has had on the jobs list", async () => {
		jobs = [
			openJob({ id: "job_1", title: "Three CVs", cvCount: 3 }),
			openJob({ id: "job_2", title: "One CV", cvCount: 1 }),
			openJob({ id: "job_3", title: "No CVs", cvCount: 0 }),
		];
		renderAt("/dashboard/jobs");

		expect(await screen.findByText("Created 22 Oct 2026 · 3 CVs")).toBeTruthy();
		expect(screen.getByText("Created 22 Oct 2026 · 1 CV")).toBeTruthy();
		expect(screen.getAllByText("Created 22 Oct 2026")).toHaveLength(1);
	});

	describe("the candidate page", () => {
		const profile = {
			email: "grace@example.com",
			phone: "+44 7946 095 800",
			location: "London, UK",
			links: [
				{ label: "GitHub", url: "https://github.com/grace-turner/" },
				{ url: "javascript:alert(1)" },
			],
			skills: ["Swift", "SwiftUI"],
			experience: [{ title: "Senior iOS Engineer", company: "Barclays", start: "2019", end: "Present", summary: "Led the app." }],
			education: [{ qualification: "BSc Computer Science", institution: "UCL", year: "2016" }],
			certifications: ["Apple Developer Academy"],
		};
		const showTab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }));
		const pager = () => within(screen.getByRole("navigation", { name: "Candidates in this job" }));
		let open: MockInstance;
		beforeEach(() => {
			open = vi.spyOn(window, "open").mockReturnValue(null);
		});
		afterEach(() => open.mockRestore());

		it("shows the rank, the email, when it was decided and the profile from the CV", async () => {
			candidates = [
				grace({ profile, decision: "shortlisted", decidedAt: "2026-10-22T14:00:00Z" }),
				fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 80, scoredAt: "2026-10-22T12:06:00Z" }),
				fakeCandidate({ id: "cand_wait", status: "scoring" }),
			];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			expect(await screen.findByText("Ranked #1 of 2")).toBeTruthy();
			expect(screen.getByRole("link", { name: "grace@example.com" }).getAttribute("href")).toBe("mailto:grace@example.com");
			expect(screen.getByText("Decided 22 Oct 2026")).toBeTruthy();

			await showTab("Profile");
			const card = screen.getByRole("region", { name: "Profile" });
			expect(within(card).getByRole("link", { name: "+44 7946 095 800" }).getAttribute("href")).toBe("tel:+447946095800");
			expect(within(card).getByText("London, UK")).toBeTruthy();
			const github = within(card).getByRole("link", { name: "github.com/grace-turner" });
			expect(github.getAttribute("href")).toBe("https://github.com/grace-turner/");
			expect(github.getAttribute("rel")).toBe("noopener noreferrer");
			expect(github.getAttribute("target")).toBe("_blank");
			// A link that is not http or https is text, never a link.
			expect(within(card).getByText("javascript:alert(1)").closest("a")).toBeNull();
			expect(within(card).getByText("SwiftUI")).toBeTruthy();
			expect(within(card).getByText(/Senior iOS Engineer/)).toBeTruthy();
			expect(within(card).getByText("2019 – Present")).toBeTruthy();
			expect(within(card).getByText("BSc Computer Science")).toBeTruthy();
			expect(within(card).getByText("Apple Developer Academy")).toBeTruthy();
		});

		it("says there is no email, and leaves out the profile card and the empty sections", async () => {
			candidates = [
				grace({ profile: { links: [], skills: ["Swift"], experience: [], education: [], certifications: [] } }),
				fakeCandidate({ id: "cand_blank", profile: { links: [], skills: [], experience: [], education: [], certifications: [] } }),
			];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			expect(await screen.findByText("No email provided")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Invite to a call" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Copy email" })).toBeNull();
			expect(screen.queryByText(/^Decided /)).toBeNull();
			await showTab("Profile");
			const card = screen.getByRole("region", { name: "Profile" });
			expect(within(card).getByRole("region", { name: "Skills" })).toBeTruthy();
			expect(within(card).queryByRole("region", { name: "Experience" })).toBeNull();
			expect(within(card).queryByRole("region", { name: "Links" })).toBeNull();

			cleanup();
			renderAt("/dashboard/jobs/job_1/candidates/cand_blank");
			expect(await screen.findByText("No email provided")).toBeTruthy();
			await showTab("Profile");
			expect(screen.queryByRole("region", { name: "Profile" })).toBeNull();
			expect(screen.getByText("The CV doesn't give contact details, links, skills or experience we could read.")).toBeTruthy();
		});

		it("copies the email from beside it, and says so", async () => {
			const writeText = vi.fn(async (_text: string) => {});
			Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
			try {
				candidates = [grace({ profile })];
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

				fireEvent.click(await screen.findByRole("button", { name: "Copy email" }));
				expect(writeText).toHaveBeenCalledExactlyOnceWith("grace@example.com");
				const said = await screen.findByText("Email copied");
				expect(said.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
			} finally {
				Reflect.deleteProperty(navigator, "clipboard");
			}
		});

		it("invites the candidate to a call in a Gmail draft and shortlists them, once", async () => {
			candidates = [grace({ profile })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			fireEvent.click(await screen.findByRole("button", { name: "Invite to a call" }));

			expect(open).toHaveBeenCalledTimes(1);
			const [href, target, features] = open.mock.calls[0];
			const url = new URL(href);
			expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
			expect(url.searchParams.get("to")).toBe("grace@example.com");
			expect(url.searchParams.get("su")).toBe("Next steps — Senior iOS Engineer");
			expect(url.searchParams.get("body")).toMatch(/^Hi Grace,/);
			expect(url.searchParams.get("body")).toMatch(/Sprite Labs$/);
			expect([target, features]).toEqual(["_blank", "noopener,noreferrer"]);
			expect(await screen.findByText("Gmail draft opened. Shortlisted Grace Turner")).toBeTruthy();
			await waitFor(() => expect(candidates[0].decision).toBe("shortlisted"));
			const decided = candidates[0].decidedAt;

			// Already shortlisted: the draft opens again, and the decision is left alone. E does the same.
			fireEvent.click(screen.getByRole("button", { name: "Invite to a call" }));
			expect(open).toHaveBeenCalledTimes(2);
			expect(await screen.findByText("Gmail draft opened")).toBeTruthy();
			fireEvent.keyDown(document.body, { key: "e" });
			expect(open).toHaveBeenCalledTimes(3);
			expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
			expect(candidates[0].decidedAt).toBe(decided);
		});

		it("writes to the address an applicant gave, and says they applied through the job page", async () => {
			candidates = [grace({ profile, source: "apply", email: "grace.applied@example.com" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			expect(await screen.findByRole("link", { name: "grace.applied@example.com" })).toBeTruthy();
			expect(screen.queryByRole("link", { name: "grace@example.com" })).toBeNull();
			expect(screen.getByText("Applied through the job page")).toBeTruthy();
		});

		it("has no invite for a CV that is not scored yet, and E does nothing", async () => {
			candidates = [grace({ status: "scoring", score: null, profile })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			expect(await screen.findByRole("link", { name: "grace@example.com" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Invite to a call" })).toBeNull();
			fireEvent.keyDown(document.body, { key: "e" });
			expect(open).not.toHaveBeenCalled();
		});

		it("steps to the previous and next candidate in the job's order, with the buttons or J and K", async () => {
			candidates = [
				grace(),
				fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 80 }),
				fakeCandidate({ id: "cand_amara", name: "Amara Okafor", score: 71, decision: "rejected" }),
			];
			const router = renderAt("/dashboard/jobs/job_1/candidates/cand_kenji");

			expect(await screen.findByRole("heading", { level: 1, name: "Kenji Tanaka" })).toBeTruthy();
			expect((await screen.findByText("2 of 3")).textContent).toBe("Candidate 2 of 3");
			expect(pager().getByRole("link", { name: "Previous candidate" }).getAttribute("href")).toBe(
				"/dashboard/jobs/job_1/candidates/cand_grace",
			);
			expect(pager().getByRole("link", { name: "Next candidate" }).getAttribute("href")).toBe(
				"/dashboard/jobs/job_1/candidates/cand_amara",
			);
			const entries = router.history.length;

			fireEvent.keyDown(document.body, { key: "j" });
			expect(await screen.findByRole("heading", { level: 1, name: "Amara Okafor" })).toBeTruthy();
			expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1/candidates/cand_amara");
			expect(pager().getByText("3 of 3")).toBeTruthy();
			// The last one has nowhere further to go.
			expect((pager().getByRole("button", { name: "Next candidate" }) as HTMLButtonElement).disabled).toBe(true);
			// Moving along replaces the entry, so Back still goes to the job.
			expect(router.history.length).toBe(entries);

			fireEvent.keyDown(document.body, { key: "k" });
			expect(await screen.findByRole("heading", { level: 1, name: "Kenji Tanaka" })).toBeTruthy();
			fireEvent.click(pager().getByRole("link", { name: "Previous candidate" }));
			expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
			expect(pager().getByText("1 of 3")).toBeTruthy();
			expect((pager().getByRole("button", { name: "Previous candidate" }) as HTMLButtonElement).disabled).toBe(true);
		});

		it("follows the job page's filter, search and sort, and keeps a candidate in place once decided", async () => {
			candidates = [
				grace(),
				fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 80 }),
				fakeCandidate({ id: "cand_amara", name: "Amara Okafor", score: 71, decision: "rejected" }),
				fakeCandidate({ id: "cand_ben", name: "Ben Carter", score: 64 }),
			];
			renderAt("/dashboard/jobs/job_1/candidates/cand_kenji?show=review&sort=name");

			// To review, by name: Ben, Grace, Kenji. Amara has a decision, so she isn't in it.
			expect((await screen.findByText("3 of 3")).textContent).toBe("Candidate 3 of 3");
			expect(pager().getByRole("link", { name: "Previous candidate" }).getAttribute("href")).toBe(
				"/dashboard/jobs/job_1/candidates/cand_grace?show=review&sort=name",
			);

			// Shortlisted, Kenji is no longer to review, but keeps his place while he is open.
			fireEvent.click(within(screen.getByRole("group", { name: "Decision" })).getByRole("button", { name: "Shortlist" }));
			await waitFor(() => expect(candidates[1].decision).toBe("shortlisted"));
			expect(pager().getByText("3 of 3")).toBeTruthy();

			fireEvent.keyDown(document.body, { key: "k" });
			expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
			expect(await screen.findByText("2 of 2")).toBeTruthy();
			expect(pager().getByRole("link", { name: "Previous candidate" }).getAttribute("href")).toBe(
				"/dashboard/jobs/job_1/candidates/cand_ben?show=review&sort=name",
			);
		});

		it("offers Open CV on the CV tab of a phone, which can't show a PDF inside the page", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			await showTab("CV");
			const panel = screen.getByRole("tabpanel", { name: "CV" });
			expect(within(panel).getByText("Open the PDF to read it in your browser's viewer.")).toBeTruthy();
			expect(within(panel).getByRole("button", { name: "Open CV" })).toBeTruthy();
			expect(within(panel).queryByTitle("CV of Grace Turner")).toBeNull();
			// Nothing is fetched until it is opened.
			expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/cv"))).toHaveLength(0);
		});
	});

	describe("decisions", () => {
		const decisionGroup = async () => screen.findByRole("group", { name: "Decision" });
		const option = (name: string) => within(screen.getByRole("group", { name: "Decision" })).getByRole("button", { name });
		const pressed = (name: string) => option(name).getAttribute("aria-pressed") === "true";
		const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
		const isPatch = (_url: string, init?: RequestInit) => init?.method === "PATCH";
		// Makes the API refuse every change with a 500.
		const refuseChanges = () => {
			const answer = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				isPatch(url, init)
					? Promise.resolve(apiError(500, "internal_error", "Something went wrong. Try again."))
					: answer(url, init),
			);
			return () => fetchMock.mockImplementation(answer);
		};
		// The note shows under the decision; Edit note opens it in a field.
		const openNote = async () => {
			fireEvent.click(await screen.findByRole("button", { name: "Edit note" }));
			return screen.getByLabelText("Note") as HTMLTextAreaElement;
		};

		describe("who decided", () => {
			const decidedBy = (userId: string | null) =>
				grace({ decision: "shortlisted", decidedAt: "2026-10-22T14:00:00Z", decidedBy: userId });
			const teammate = {
				userId: "user_2",
				role: "member",
				name: "Ben Carter",
				email: "ben@example.com",
				imageUrl: null,
				joinedAt: "2026-10-05T09:00:00Z",
				isYou: false,
			};

			it("names the teammate who made the decision, with the date", async () => {
				teamMembers = [teammate];
				candidates = [decidedBy("user_2")];
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
				expect(await screen.findByText("Ben Carter · Decided 22 Oct 2026")).toBeTruthy();
			});

			it("says You for the signed-in recruiter, and Former member for someone no longer on the team", async () => {
				candidates = [decidedBy("user_1")];
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
				expect(await screen.findByText("You · Decided 22 Oct 2026")).toBeTruthy();
				cleanup();

				candidates = [decidedBy("user_gone")];
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
				expect(await screen.findByText("Former member · Decided 22 Oct 2026")).toBeTruthy();
			});

			it("shows nothing while undecided, and You as soon as a decision is made", async () => {
				candidates = [grace()];
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
				await decisionGroup();
				expect(screen.queryByText(/Decided/)).toBeNull();

				fireEvent.click(option("Shortlist"));
				expect(await screen.findByText(/^You · Decided /)).toBeTruthy();
			});
		});

		it("shows the decision as a group of three toggle buttons, undecided to begin with, above the evidence", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			const group = await decisionGroup();
			const options = within(group).getAllByRole("button");
			expect(options.map((button) => button.textContent)).toEqual(["Shortlist", "Not a fit", "Undecided"]);
			expect(options.map((button) => button.getAttribute("aria-keyshortcuts"))).toEqual(["S", "X", "U"]);
			expect(options.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
			// One tab stop, on the chosen one.
			expect(options.map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
			expect(screen.getByRole("heading", { level: 2, name: "Decision" })).toBeTruthy();

			// In reach before the evidence, not under it.
			const tabs = screen.getByRole("tablist", { name: "About Grace Turner" });
			expect(group.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		});

		it("moves focus between the decisions with the arrow keys without deciding anything", async () => {
			candidates = [grace({ decision: "shortlisted" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();

			option("Shortlist").focus();
			fireEvent.keyDown(option("Shortlist"), { key: "ArrowRight" });
			expect(document.activeElement).toBe(option("Not a fit"));
			// The tab stop follows focus while it is inside the group.
			expect(option("Not a fit").tabIndex).toBe(0);
			expect(option("Shortlist").tabIndex).toBe(-1);
			fireEvent.keyDown(option("Not a fit"), { key: "ArrowDown" });
			expect(document.activeElement).toBe(option("Undecided"));
			fireEvent.keyDown(option("Undecided"), { key: "ArrowRight" });
			expect(document.activeElement).toBe(option("Shortlist"));
			fireEvent.keyDown(option("Shortlist"), { key: "ArrowLeft" });
			expect(document.activeElement).toBe(option("Undecided"));
			fireEvent.keyDown(option("Undecided"), { key: "Home" });
			expect(document.activeElement).toBe(option("Shortlist"));
			fireEvent.keyDown(option("Shortlist"), { key: "End" });
			expect(document.activeElement).toBe(option("Undecided"));

			// Nothing was decided on the way.
			await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
			expect(patches()).toHaveLength(0);
			expect(pressed("Shortlist")).toBe(true);
			expect(screen.queryByText(/Marked Grace Turner/)).toBeNull();

			// Choosing it is what decides.
			fireEvent.click(option("Undecided"));
			await waitFor(() => expect(candidates[0].decision).toBe("undecided"));
			expect(patches()).toHaveLength(1);
		});

		it("shortlists, rejects and un-decides at once, sends only the decision and says each change", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();
			const saving = hold(isPatch);

			fireEvent.click(option("Shortlist"));
			const said = await screen.findByText("Shortlisted Grace Turner");
			expect(said.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
			// The page shows it before the API has answered.
			await waitFor(() => expect(saving.pending()).toBe(1));
			expect(pressed("Shortlist")).toBe(true);
			expect(pressed("Undecided")).toBe(false);
			expect(patches()).toHaveLength(1);
			expect(fetchMock).toHaveBeenLastCalledWith(
				"http://localhost:8787/jobs/job_1/candidates/cand_grace",
				expect.objectContaining({
					method: "PATCH",
					body: JSON.stringify({ decision: "shortlisted" }),
					headers: expect.objectContaining({
						Authorization: "Bearer session-token",
						"Content-Type": "application/json",
					}),
				}),
			);
			await act(async () => saving.release());
			await waitFor(() => expect(candidates[0].decision).toBe("shortlisted"));
			expect(pressed("Shortlist")).toBe(true);

			fireEvent.click(option("Not a fit"));
			expect(await screen.findByText("Marked Grace Turner as not a fit")).toBeTruthy();
			await waitFor(() => expect(patches()).toHaveLength(2));
			expect(pressed("Not a fit")).toBe(true);
			expect(patches()[1][1]?.body).toBe(JSON.stringify({ decision: "rejected" }));
			await act(async () => saving.release());

			fireEvent.click(option("Undecided"));
			expect(await screen.findByText("Marked Grace Turner as undecided")).toBeTruthy();
			await waitFor(() => expect(patches()).toHaveLength(3));
			expect(pressed("Undecided")).toBe(true);
			await act(async () => saving.release());
			await waitFor(() => expect(candidates[0]).toMatchObject({ decision: "undecided", decidedAt: null }));
			expect(screen.queryByRole("alert")).toBeNull();
		});

		it("puts the old decision back with the toast's Undo", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();

			fireEvent.click(option("Not a fit"));
			const toast = (await screen.findByText("Marked Grace Turner as not a fit")).closest("li")!;
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
			fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

			await waitFor(() => expect(candidates[0]).toMatchObject({ decision: "undecided", decidedAt: null }));
			expect(pressed("Undecided")).toBe(true);
			expect(patches().map(([, init]) => init?.body)).toEqual([
				JSON.stringify({ decision: "rejected" }),
				JSON.stringify({ decision: "undecided" }),
			]);
		});

		it("decides with S, X and U, but not while typing in the note", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();

			fireEvent.keyDown(document.body, { key: "s" });
			await waitFor(() => expect(candidates[0].decision).toBe("shortlisted"));
			expect(pressed("Shortlist")).toBe(true);
			fireEvent.keyDown(document.body, { key: "x" });
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
			fireEvent.keyDown(document.body, { key: "u" });
			await waitFor(() => expect(candidates[0].decision).toBe("undecided"));
			expect(patches()).toHaveLength(3);

			// In the note, the letters are only letters.
			const note = await openNote();
			fireEvent.keyDown(note, { key: "s" });
			fireEvent.keyDown(note, { key: "x" });
			expect(patches()).toHaveLength(3);
			expect(pressed("Undecided")).toBe(true);
		});

		it("lets a member decide too", async () => {
			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();

			fireEvent.click(option("Not a fit"));
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
			expect(pressed("Not a fit")).toBe(true);
		});

		it("puts the old decision back and says why when the API refuses", async () => {
			candidates = [grace({ decision: "shortlisted" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();
			expect(pressed("Shortlist")).toBe(true);
			refuseChanges();
			const refusing = hold(isPatch);

			fireEvent.click(option("Not a fit"));
			await waitFor(() => expect(refusing.pending()).toBe(1));
			expect(pressed("Not a fit")).toBe(true);
			await act(async () => refusing.release());

			expect((await screen.findByRole("alert")).textContent).toBe("✕ Something went wrong. Try again.");
			expect(pressed("Shortlist")).toBe(true);
			expect(pressed("Not a fit")).toBe(false);
			// The toast doesn't stay to say a change happened that didn't.
			await waitFor(() => expect(screen.queryByText("Marked Grace Turner as not a fit")).toBeNull());
			expect(candidates[0].decision).toBe("shortlisted");
		});

		it("updates the cached candidate and list at once, and puts both back when the API refuses", async () => {
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			);
			const listKey = ["candidates", "user_1", "job_1"];
			const detailKey = [...listKey, "cand_grace"];
			const kenji = fakeCandidate({ id: "cand_kenji", score: 71 });
			client.setQueryData(detailKey, forPage(grace({ note: "Old note" })));
			client.setQueryData(listKey, {
				candidates: [summary(grace()), summary(kenji)],
				cvCount: 2,
				cvLimit: 10,
			});
			candidates = [grace({ note: "Old note" }), kenji];
			const rows = () =>
				client
					.getQueryData<{ candidates: { id: string; decision: string }[] }>(listKey)
					?.candidates.map((c) => [c.id, c.decision]);
			const detail = () => client.getQueryData<Candidate>(detailKey);

			const { result } = renderHook(() => useDecideCandidate("job_1", "cand_grace"), { wrapper });
			const saving = hold(isPatch);
			act(() => result.current.mutate({ decision: "shortlisted", note: "  New note " }));

			await waitFor(() => expect(detail()).toMatchObject({ decision: "shortlisted", note: "New note" }));
			expect(detail()?.decidedAt).not.toBeNull();
			expect(rows()).toEqual([["cand_grace", "shortlisted"], ["cand_kenji", "undecided"]]);
			await waitFor(() => expect(saving.pending()).toBe(1));
			await act(async () => saving.release());
			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			// Now a refusal.
			refuseChanges();
			act(() => result.current.mutate({ decision: "rejected", note: "" }));
			await waitFor(() => expect(result.current.isError).toBe(true));
			await waitFor(() => expect(detail()).toMatchObject({ decision: "shortlisted", note: "New note" }));
			expect(rows()).toEqual([["cand_grace", "shortlisted"], ["cand_kenji", "undecided"]]);
		});

		it("pre-fills the note and saves it a moment after typing stops", async () => {
			candidates = [grace({ note: "Strong on SwiftUI." })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			expect(await screen.findByText("Strong on SwiftUI.")).toBeTruthy();
			const note = await openNote();
			expect(document.activeElement).toBe(note);
			expect(note.value).toBe("Strong on SwiftUI.");
			expect(note.maxLength).toBe(1000);
			expect(screen.getByText("18 / 1,000")).toBeTruthy();
			expect(screen.getByText("Everyone at Sprite Labs can read this. It saves as you type.")).toBeTruthy();

			fireEvent.change(note, { target: { value: "Strong on SwiftUI. Call on Monday." } });
			expect(screen.getByText("34 / 1,000")).toBeTruthy();
			// Nothing goes while the recruiter is still typing.
			expect(patches()).toHaveLength(0);
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(patches()).toHaveLength(1);
			expect(patches()[0]).toEqual([
				"http://localhost:8787/jobs/job_1/candidates/cand_grace",
				expect.objectContaining({
					method: "PATCH",
					body: JSON.stringify({ note: "Strong on SwiftUI. Call on Monday." }),
				}),
			]);
			expect(candidates[0].note).toBe("Strong on SwiftUI. Call on Monday.");
			expect(note.value).toBe("Strong on SwiftUI. Call on Monday.");
			expect(screen.getByText("Saved").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");

			// Typing again clears the confirmation, and an empty note clears the saved one.
			fireEvent.change(note, { target: { value: "   " } });
			expect(screen.queryByText("Saved")).toBeNull();
			await waitFor(() => expect(candidates[0].note).toBeNull());
			expect(await screen.findByText("Saved")).toBeTruthy();
		});

		it("saves the note once when leaving the field, and says Saving meanwhile", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			const note = await openNote();
			const saving = hold(isPatch);

			fireEvent.change(note, { target: { value: "New note" } });
			fireEvent.blur(note);
			await waitFor(() => expect(saving.pending()).toBe(1));
			expect(screen.getByText("Saving")).toBeTruthy();
			// Leaving the field stopped the timer, so nothing else goes.
			await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
			expect(saving.pending()).toBe(1);

			await act(async () => saving.release());
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(patches()).toHaveLength(1);
			expect(candidates[0].note).toBe("New note");
		});

		it("shows a teammate's later edit once the field is left, after a save that finished while typing", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			const note = await openNote();

			fireEvent.change(note, { target: { value: "New note" } });
			// Saved while the field still has focus, so what was typed stays.
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(note.value).toBe("New note");
			fireEvent.blur(note);

			// A teammate changes it; the next answer from the API (after S here) shows it.
			candidates[0].note = "Ask about Kotlin";
			fireEvent.keyDown(document.body, { key: "s" });
			await waitFor(() => expect(note.value).toBe("Ask about Kotlin"));
		});

		it("keeps what was typed and says why when a note can't be saved, and saves it again", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			const note = await openNote();
			const accept = refuseChanges();

			fireEvent.change(note, { target: { value: "A better note" } });
			fireEvent.blur(note);

			const alert = await screen.findByRole("alert");
			expect(within(alert).getByText("✕ The note isn't saved. Something went wrong. Try again.")).toBeTruthy();
			expect(note.value).toBe("A better note");
			expect(screen.queryByText("Saved")).toBeNull();
			expect(candidates[0].note).toBe("Old note");

			accept();
			fireEvent.click(within(alert).getByRole("button", { name: "Save again" }));
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(candidates[0].note).toBe("A better note");
			expect(screen.queryByRole("alert")).toBeNull();
		});

		it("can decide on a CV that failed", async () => {
			candidates = [
				fakeCandidate({ id: "cand_bad", fileName: "scan.pdf", status: "failed", error: "Scoring failed." }),
			];
			renderAt("/dashboard/jobs/job_1/candidates/cand_bad");
			await decisionGroup();

			fireEvent.click(option("Not a fit"));
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
		});

		it("shows a decision made on the candidate page in the list", async () => {
			candidates = [grace(), fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			await decisionGroup();
			fireEvent.click(option("Shortlist"));
			await waitFor(() => expect(candidates[0].decision).toBe("shortlisted"));
			const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
			fireEvent.click(crumbs.getByRole("link", { name: "Senior iOS Engineer" }));

			const list = await screen.findByRole("list", { name: "Candidates" });
			expect(within(list).getByText("Shortlisted")).toBeTruthy();
		});
	});

	describe("the ranked list", () => {
		const ana = () => fakeCandidate({ id: "cand_ana", name: "Ana Silva", score: 65, decision: "rejected" });
		const kenji = () => fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 });
		const filter = () => screen.getByRole("radiogroup", { name: "Show" });
		// The filter lives in the address, so the list follows once the router has moved.
		const show = async (name: string) => {
			const radio = within(filter()).getByRole("radio", { name }) as HTMLInputElement;
			fireEvent.click(radio);
			await waitFor(() => expect(radio.checked).toBe(true));
		};

		it("marks shortlisted and rejected CVs in words, mutes the rejected and leaves the others alone", async () => {
			candidates = [grace({ decision: "shortlisted" }), kenji(), ana()];
			renderAt("/dashboard/jobs/job_1");

			const list = await screen.findByRole("list", { name: "Candidates" });
			const shortlisted = within(list).getByText("Shortlisted");
			expect(shortlisted.className).toContain("bg-marker");
			const rejected = within(list).getByText("Not a fit");
			expect(rejected.className).toContain("bg-gap");
			// Nothing on the undecided row.
			const rows = within(list).getAllByRole("listitem");
			expect(rows[1].textContent).toMatch(/Kenji Tanaka/);
			expect(rows[1].textContent).not.toMatch(/Shortlisted|Not a fit|Undecided/);
			expect(rows[0].textContent).toMatch(/Grace Turner.*Decision: Shortlisted/);
			// Muted, in a colour that keeps its contrast, rather than faded.
			expect(within(rows[2]).getByText("Ana Silva").className).toContain("text-ink-muted");
			expect(within(rows[1]).getByText("Kenji Tanaka").className).not.toContain("text-ink-muted");
		});

		it("filters by decision, with counts, and keeps each CV's rank", async () => {
			candidates = [
				grace({ decision: "shortlisted" }),
				kenji(),
				ana(),
				fakeCandidate({ id: "cand_new", fileName: "new_upload.pdf", status: "queued" }),
				fakeCandidate({ id: "cand_bad", fileName: "scan.pdf", status: "failed", error: "We couldn't read this file." }),
			];
			const router = renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			const options = within(filter()).getAllByRole("radio") as HTMLInputElement[];
			expect(options.map((option) => option.labels?.[0].textContent)).toEqual([
				"All 5",
				"To review 1",
				"Shortlisted 1",
				"Not a fit 1",
				"Reading 1",
				"Failed 1",
			]);
			expect(options.map((option) => option.checked)).toEqual([true, false, false, false, false, false]);
			expect(rowTexts()).toHaveLength(5);

			await show("Not a fit 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 3: Ana Silva/)]);
			// "To review" is a scored CV nobody has decided on yet.
			await show("To review 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 2: Kenji Tanaka/)]);
			// The filter goes into the address, so a reload or Back keeps it.
			await waitFor(() => expect(router.state.location.search).toEqual({ show: "review" }));
			await show("Reading 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/new_upload\.pdf/)]);
			await show("Failed 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/scan\.pdf/)]);
			await show("Shortlisted 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 1: Grace Turner/)]);
			expect(screen.getByText("Showing 1 of 5")).toBeTruthy();
			await show("All 5");
			expect(rowTexts()).toHaveLength(5);
			await waitFor(() => expect(router.state.location.search).toEqual({}));
			// The filter only hides rows. The header still counts the whole list, and nothing was asked of the API.
			expect(screen.getByText("3 of 5 read · 1 failed")).toBeTruthy();
			expect(patches()).toHaveLength(0);
		});

		it("says when nothing has that decision", async () => {
			candidates = [grace(), kenji()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			await show("Shortlisted 0");
			expect(screen.getByText("No shortlisted candidates yet.")).toBeTruthy();
			expect(screen.queryByRole("list", { name: "Candidates" })).toBeNull();
			await show("Not a fit 0");
			expect(screen.getByText("No candidates marked Not a fit yet.")).toBeTruthy();
			await show("To review 2");
			expect(screen.queryByText(/No .* yet\./)).toBeNull();
			expect(rowTexts()).toHaveLength(2);

			candidates = [];
			cleanup();
			candidates = [grace({ decision: "rejected" })];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");
			await show("To review 0");
			expect(screen.getByText("Nothing to review. Every scored CV has a decision.")).toBeTruthy();
		});

		it("leaves Reading and Failed out while nothing is in them, unless the address asks for them", async () => {
			candidates = [grace(), kenji()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");
			expect(within(filter()).getAllByRole("radio").map((option) => (option as HTMLInputElement).labels?.[0].textContent)).toEqual([
				"All 2",
				"To review 2",
				"Shortlisted 0",
				"Not a fit 0",
			]);
			cleanup();

			renderAt("/dashboard/jobs/job_1?show=failed");
			await screen.findByText("No CVs failed. Every upload was read.");
			expect((within(filter()).getByRole("radio", { name: "Failed 0" }) as HTMLInputElement).checked).toBe(true);
		});

		const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
	});

	describe("list tools", () => {
		const ana = () => fakeCandidate({ id: "cand_ana", name: "Ana Silva", score: 65, headline: "Android dev" });
		const kenji = () =>
			fakeCandidate({
				id: "cand_kenji",
				name: "Kenji Tanaka",
				score: 71,
				summary: "Knows Kotlin Multiplatform well.",
				profile: { email: "kenji@example.com", links: [], skills: [], experience: [], education: [], certifications: [] },
			});
		const queued = () => fakeCandidate({ id: "cand_new", fileName: "new_upload.pdf", status: "queued" });
		const failed = () => fakeCandidate({ id: "cand_bad", fileName: "scan.pdf", status: "failed", error: "No." });
		const search = () => screen.getByRole("searchbox", { name: "Search candidates" }) as HTMLInputElement;

		it("searches name, email and summary, and clears the search", async () => {
			candidates = [grace(), kenji(), ana(), queued()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			fireEvent.change(search(), { target: { value: "kenji@EXAMPLE" } });
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 2: Kenji Tanaka/)]);
			expect(screen.getByText("Showing 1 of 4")).toBeTruthy();
			fireEvent.change(search(), { target: { value: "multiplatform" } });
			expect(rowTexts()).toEqual([expect.stringMatching(/Kenji Tanaka/)]);
			fireEvent.change(search(), { target: { value: "android" } });
			// The rank belongs to the CV, not to the row's place on screen.
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 3: Ana Silva/)]);

			fireEvent.change(search(), { target: { value: "nobody" } });
			expect(screen.getByText("No candidates match your search and filters.")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
			expect(search().value).toBe("");
			expect(rowTexts()).toHaveLength(4);
		});

		it("searches within the filter, and keeps counting the whole list", async () => {
			candidates = [grace({ decision: "shortlisted" }), kenji(), queued(), failed()];
			const router = renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			fireEvent.click(screen.getByRole("radio", { name: "Shortlisted 1" }));
			await waitFor(() => expect(rowTexts()).toEqual([expect.stringMatching(/Rank 1: Grace Turner/)]));
			// Kenji isn't shortlisted.
			fireEvent.change(search(), { target: { value: "kenji" } });
			expect(screen.getByText("No candidates match your search and filters.")).toBeTruthy();
			// The words go into the address after a pause.
			await waitFor(() => expect(router.state.location.search).toEqual({ show: "shortlisted", q: "kenji" }));
			fireEvent.click(screen.getByRole("radio", { name: "All 4" }));
			await waitFor(() => expect(rowTexts()).toEqual([expect.stringMatching(/Rank 2: Kenji Tanaka/)]));
			// The "Show" counts and the header still count the whole list.
			expect(screen.getByRole("radio", { name: "Failed 1" })).toBeTruthy();
			expect(screen.getByText("2 of 4 read · 1 failed")).toBeTruthy();
		});

		it("reads the filter, search and sort from the address, and drops what it doesn't know", async () => {
			candidates = [grace({ decision: "shortlisted" }), kenji(), ana()];
			const router = renderAt("/dashboard/jobs/job_1?show=review&q=ana&sort=name");
			expect(await screen.findByText("Ana Silva")).toBeTruthy();
			expect(search().value).toBe("ana");
			expect((screen.getByRole("radio", { name: "To review 2" }) as HTMLInputElement).checked).toBe(true);
			expect(screen.getByRole("button", { name: /^Sort: Name A–Z/ })).toBeTruthy();
			cleanup();

			renderAt("/dashboard/jobs/job_1?show=maybe&sort=random&tab=other&c=%3Cscript%3E");
			await screen.findByText("Grace Turner");
			expect(rowTexts()).toHaveLength(3);
			expect((screen.getByRole("radio", { name: "All 3" }) as HTMLInputElement).checked).toBe(true);
			expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1");
		});

		it("sorts, and keeps CVs without a score after the scored ones every time", async () => {
			candidates = [
				grace({ createdAt: "2026-10-22T12:01:00Z" }),
				kenji(),
				ana(),
				queued(),
				failed(),
			];
			candidates[1].createdAt = "2026-10-22T12:03:00Z";
			candidates[2].createdAt = "2026-10-22T12:02:00Z";
			const router = renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			const sortButton = screen.getByRole("button", { name: "Sort: Best match" });
			fireEvent.click(sortButton);
			const items = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
			expect(items.map((item) => item.textContent)).toEqual(["Best match", "Newest", "Name A–Z"]);
			expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

			const names = () => rowTexts().map((text) => text?.match(/(Grace Turner|Kenji Tanaka|Ana Silva|new_upload\.pdf|scan\.pdf)/)?.[0]);
			const sorted = async (name: string) => {
				fireEvent.click(screen.getByRole("button", { name: /^Sort: / }));
				fireEvent.click(screen.getByRole("menuitemradio", { name }));
				await screen.findByRole("button", { name: `Sort: ${name}` });
				return names();
			};
			expect(names()).toEqual(["Grace Turner", "Kenji Tanaka", "Ana Silva", "new_upload.pdf", "scan.pdf"]);
			expect(await sorted("Newest")).toEqual(["Kenji Tanaka", "Ana Silva", "Grace Turner", "new_upload.pdf", "scan.pdf"]);
			await waitFor(() => expect(router.state.location.search).toEqual({ sort: "newest" }));
			expect(await sorted("Name A–Z")).toEqual(["Ana Silva", "Grace Turner", "Kenji Tanaka", "new_upload.pdf", "scan.pdf"]);
			expect(await sorted("Best match")).toEqual(["Grace Turner", "Kenji Tanaka", "Ana Silva", "new_upload.pdf", "scan.pdf"]);
		});

		it("shows 50 rows and adds 50 more at a time, at 120 candidates", async () => {
			candidates = Array.from({ length: 120 }, (_, index) =>
				fakeCandidate({ id: `cand_${index}`, name: `Candidate ${String(index).padStart(3, "0")}`, score: 100 - (index % 100) }),
			);
			// The list ranks the fake's order, so give each a distinct score.
			candidates.forEach((candidate, index) => (candidate.score = 200 - index));
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Candidate 000");

			expect(rowTexts()).toHaveLength(50);
			expect(screen.getByText("50 of 120 shown")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
			expect(rowTexts()).toHaveLength(100);
			// Only 20 are left, so that is what the button offers.
			fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
			expect(rowTexts()).toHaveLength(120);
			expect(screen.queryByRole("button", { name: /^Show \d+ more$/ })).toBeNull();

			// A search starts again from the top of the matches, with their own ranks.
			fireEvent.change(search(), { target: { value: "Candidate 11" } });
			expect(rowTexts()).toHaveLength(10);
			expect(rowTexts()[0]).toMatch(/Rank 111: Candidate 110/);
		}, 30_000);

		it("marks a row that has a note", async () => {
			candidates = [grace({ note: "Call Monday" }), kenji()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			const rows = within(screen.getByRole("list", { name: "Candidates" })).getAllByRole("listitem");
			expect(within(rows[0]).getByText("Has a note")).toBeTruthy();
			expect(within(rows[1]).queryByText("Has a note")).toBeNull();
		});

		it("exports the candidates as a CSV from the menu, with the session token", async () => {
			candidates = [grace(), kenji()];
			const clicked: { href: string; download: string }[] = [];
			const createObjectURL = vi.fn((_blob: Blob) => "blob:csv-1");
			Object.assign(URL, { createObjectURL, revokeObjectURL: () => {} });
			const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
				clicked.push({ href: this.href, download: this.download });
			});
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");
			const button = screen.getByRole("button", { name: "More actions" });

			expect(button.getAttribute("aria-expanded")).toBe("false");
			fireEvent.click(button);
			expect(button.getAttribute("aria-expanded")).toBe("true");
			const group = screen.getByRole("group", { name: "Export CSV" });
			expect(within(group).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
				"All candidates",
				"Shortlisted",
				"Undecided",
				"Not a fit",
			]);
			// Escape closes it and gives focus back.
			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
			expect(screen.queryByRole("menuitem", { name: "All candidates" })).toBeNull();
			expect(document.activeElement).toBe(button);

			fireEvent.click(button);
			fireEvent.click(screen.getByRole("menuitem", { name: "Shortlisted" }));
			await waitFor(() => expect(clicked).toHaveLength(1));
			expect(clicked[0]).toEqual({ href: "blob:csv-1", download: "senior-ios-engineer-shortlisted-applicants.csv" });
			const request = fetchMock.mock.calls.find(([url]) => url.includes("export.csv"))!;
			expect(request[0]).toBe("http://localhost:8787/jobs/job_1/candidates/export.csv?decision=shortlisted");
			expect(request[1]).toEqual(expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }));
			const blob = createObjectURL.mock.calls[0][0];
			expect(blob.type).toContain("text/csv");
			expect(await screen.findByText("Downloaded the job's CSV")).toBeTruthy();

			fireEvent.click(button);
			fireEvent.click(screen.getByRole("menuitem", { name: "All candidates" }));
			await waitFor(() => expect(clicked).toHaveLength(2));
			expect(clicked[1].download).toBe("senior-ios-engineer-applicants.csv");
			click.mockRestore();
			Reflect.deleteProperty(URL, "createObjectURL");
			Reflect.deleteProperty(URL, "revokeObjectURL");
		});

		it("says so when the export fails", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");
			const answer = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				url.includes("export.csv") ? Promise.resolve(apiError(500, "server_error", "Boom")) : answer(url, init),
			);
			await chooseMore("Not a fit");

			const toast = await screen.findByText("We couldn't export the candidates. Try again.");
			expect(toast.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
		});

		it("checks rows for the bulk bar, with a box for all of them, and leaves Delete to admins", async () => {
			candidates = [grace(), kenji()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			fireEvent.click(screen.getByRole("checkbox", { name: "Select Kenji Tanaka" }));
			const bar = screen.getByRole("region", { name: "Selected candidates" });
			expect(within(bar).getByText("1 selected")).toBeTruthy();
			const all = screen.getByRole("checkbox", { name: "Select all shown" }) as HTMLInputElement;
			expect(all.indeterminate).toBe(true);
			fireEvent.click(all);
			expect(within(bar).getByText("2 selected")).toBeTruthy();
			expect(all.checked).toBe(true);
			expect(within(bar).getByRole("button", { name: "Delete 2 candidates" })).toBeTruthy();
			// Esc empties the selection.
			fireEvent.keyDown(document.body, { key: "Escape" });
			expect(screen.queryByRole("region", { name: "Selected candidates" })).toBeNull();
			cleanup();

			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			renderAt("/dashboard/jobs/job_1");
			fireEvent.click(await screen.findByRole("checkbox", { name: "Select Grace Turner" }));
			expect(within(screen.getByRole("region", { name: "Selected candidates" })).queryByRole("button", { name: /^Delete/ })).toBeNull();
		});
	});

	describe("the workspace", () => {
		const kenji = () => fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 });
		const ana = () => fakeCandidate({ id: "cand_ana", name: "Ana Silva", score: 65 });
		const rowLink = (name: string) => within(screen.getByRole("list", { name: "Candidates" })).getByRole("link", { name: new RegExp(name) });
		const selected = () =>
			within(screen.getByRole("list", { name: "Candidates" }))
				.getAllByRole("link")
				.filter((link) => link.getAttribute("aria-current") === "true")
				.map((link) => link.textContent?.match(/Grace Turner|Kenji Tanaka|Ana Silva/)?.[0]);
		// From 1100px the list and the selected candidate sit side by side.
		const wide = () =>
			vi.stubGlobal("matchMedia", (query: string) => ({
				matches: query === "(min-width: 1100px)",
				addEventListener: () => {},
				removeEventListener: () => {},
			}));
		const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });

		it("selects the first row in the split view, and moves with J and K but not while typing", async () => {
			wide();
			candidates = [grace(), kenji(), ana()];
			const router = renderAt("/dashboard/jobs/job_1");

			// The selected candidate is beside the list.
			expect(await screen.findByRole("article", { name: "Grace Turner" })).toBeTruthy();
			expect(selected()).toEqual(["Grace Turner"]);

			press("j");
			await waitFor(() => expect(selected()).toEqual(["Kenji Tanaka"]));
			expect(router.state.location.search).toEqual({ c: "cand_kenji" });
			expect(await screen.findByRole("article", { name: "Kenji Tanaka" })).toBeTruthy();
			// Focus follows the selection, so the keyboard carries on from there.
			await waitFor(() => expect(document.activeElement).toBe(rowLink("Kenji Tanaka")));
			press("ArrowDown");
			await waitFor(() => expect(selected()).toEqual(["Ana Silva"]));
			press("k");
			await waitFor(() => expect(selected()).toEqual(["Kenji Tanaka"]));

			// "/" goes to the search, and letters typed there are words, not shortcuts.
			press("/");
			const search = screen.getByRole("searchbox", { name: "Search candidates" });
			expect(document.activeElement).toBe(search);
			press("j", search);
			expect(selected()).toEqual(["Kenji Tanaka"]);

			// A plain click selects; Enter opens the candidate's own page.
			fireEvent.click(rowLink("Grace Turner"));
			await waitFor(() => expect(selected()).toEqual(["Grace Turner"]));
			press("Enter");
			await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1/candidates/cand_grace"));
		});

		it("moves to the next row when the selected candidate leaves the list after a decision", async () => {
			wide();
			candidates = [grace(), kenji(), ana()];
			const router = renderAt("/dashboard/jobs/job_1?show=review&c=cand_kenji");

			expect(await screen.findByRole("article", { name: "Kenji Tanaka" })).toBeTruthy();
			expect(selected()).toEqual(["Kenji Tanaka"]);
			// S shortlists, so Kenji is no longer to review: the row now in his place takes over.
			press("s");
			await waitFor(() => expect(selected()).toEqual(["Ana Silva"]));
			expect(within(screen.getByRole("list", { name: "Candidates" })).queryByText("Kenji Tanaka")).toBeNull();
			await waitFor(() => expect(router.state.location.search).toEqual({ show: "review", c: "cand_ana" }));
			expect(await screen.findByRole("article", { name: "Ana Silva" })).toBeTruthy();

			// The last row leaving hands over to the one before it.
			press("x");
			await waitFor(() => expect(selected()).toEqual(["Grace Turner"]));
		});

		it("opens the candidate's page from a row on a narrow screen, and Back returns to the same view", async () => {
			candidates = [grace(), kenji()];
			const router = renderAt("/dashboard/jobs/job_1?show=review");
			await screen.findByText("Kenji Tanaka");
			// Nothing is highlighted until a row has been opened.
			expect(selected()).toEqual([]);
			expect(rowLink("Kenji Tanaka").getAttribute("href")).toBe("/dashboard/jobs/job_1/candidates/cand_kenji?show=review");

			fireEvent.click(rowLink("Kenji Tanaka"));
			await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/jobs/job_1/candidates/cand_kenji"));
			expect(router.state.location.search).toEqual({ show: "review" });

			await act(async () => router.history.back());
			await waitFor(() => expect(selected()).toEqual(["Kenji Tanaka"]));
			expect(router.state.location.search).toEqual({ show: "review", c: "cand_kenji" });
		});

		it("opens the upload drawer from a link that ends in #upload, and takes the hash off", async () => {
			const router = renderAt("/dashboard/jobs/job_1#upload");
			const drawer = within(await screen.findByRole("dialog", { name: "Upload CVs" }));
			expect(drawer.getByLabelText("Choose PDFs")).toBeTruthy();
			await waitFor(() => expect(router.state.location.hash).toBe(""));
		});

		it("takes PDFs dropped anywhere on the page, and shows them in the drawer", async () => {
			renderAt("/dashboard/jobs/job_1");
			const main = await screen.findByRole("main");
			await within(main).findByRole("heading", { name: "No CVs yet" });

			fireEvent.dragEnter(main, { dataTransfer: { types: ["Files"] } });
			expect(screen.getByText(/Drop CVs to add them to/).textContent).toContain("Senior iOS Engineer");
			fireEvent.drop(main, { dataTransfer: { types: ["Files"], files: [pdf("dropped.pdf")] } });

			const drawer = within(await screen.findByRole("dialog", { name: "Upload CVs" }));
			expect(await drawer.findByText("1 CV uploaded")).toBeTruthy();
			expect(screen.queryByText(/Drop CVs to add them to/)).toBeNull();
			expect(within(screen.getByRole("list", { name: "Candidates" })).getByText("dropped.pdf")).toBeTruthy();
		});

		it("says why a dropped file can't go in when the job is not open", async () => {
			jobs = [openJob({ status: "closed" })];
			renderAt("/dashboard/jobs/job_1");
			const main = await screen.findByRole("main");
			await within(main).findByText(/This job is closed/);

			fireEvent.dragEnter(main, { dataTransfer: { types: ["Files"] } });
			expect(screen.getByText("✕ Can't add CVs")).toBeTruthy();
			fireEvent.drop(main, { dataTransfer: { types: ["Files"], files: [pdf("late.pdf")] } });
			expect(uploads()).toHaveLength(0);
			expect(screen.queryByRole("dialog", { name: "Upload CVs" })).toBeNull();
		});

		it("keeps uploading with the drawer closed, says how far it has got, and how it went", async () => {
			renderAt("/dashboard/jobs/job_1");
			const sending = hold(isUpload);
			await sendPdfs(await chooser(), [pdf("one.pdf"), pdf("two.pdf")]);
			await waitFor(() => expect(sending.pending()).toBe(2));
			fireEvent.click(within(screen.getByRole("dialog", { name: "Upload CVs" })).getByRole("button", { name: "Close" }));

			// The header's pill reopens the drawer.
			const pill = await screen.findByRole("button", { name: /^Uploading 2 of 2/ });
			fireEvent.click(pill);
			expect(await screen.findByRole("dialog", { name: "Upload CVs" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: /^Uploading 2 of 2/ })).toBeNull();
			fireEvent.click(within(screen.getByRole("dialog", { name: "Upload CVs" })).getByRole("button", { name: "Close" }));

			await act(async () => sending.release());
			const done = await within(screen.getByRole("region", { name: "Notifications" })).findByText("2 CVs uploaded");
			expect(done).toBeTruthy();
			expect(screen.queryByRole("button", { name: /^Uploading/ })).toBeNull();
		});
	});

	describe("Open CV", () => {
		const createObjectURL = vi.fn((_blob: Blob) => "blob:cv-1");
		const revokeObjectURL = vi.fn();
		const tab = { location: { href: "" }, close: vi.fn() };
		const cvRequests = () =>
			fetchMock.mock.calls.filter(([url]) => url.endsWith("/jobs/job_1/candidates/cand_grace/cv"));
		let open: MockInstance<typeof window.open>;

		beforeEach(() => {
			tab.location.href = "";
			tab.close.mockClear();
			createObjectURL.mockClear();
			revokeObjectURL.mockClear();
			// jsdom has neither of these.
			Object.assign(URL, { createObjectURL, revokeObjectURL });
			open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
			candidates = [grace()];
		});

		afterEach(() => {
			open.mockRestore();
			Reflect.deleteProperty(URL, "createObjectURL");
			Reflect.deleteProperty(URL, "revokeObjectURL");
		});

		it("opens the tab inside the click, then fetches the PDF with the token and sends the tab to it", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			const button = await screen.findByRole("button", { name: "Open CV" });
			// It sits on the card that names the file.
			expect(screen.getByRole("region", { name: "CV file" }).contains(button)).toBe(true);

			fireEvent.click(button);
			// Before anything is fetched, or the browser would take the tab for a popup.
			expect(open).toHaveBeenCalledWith("", "_blank");
			expect(cvRequests()).toHaveLength(0);
			await waitFor(() => expect(cvRequests()).toHaveLength(1));
			expect(cvRequests()[0][1]).toEqual(
				expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer session-token" } }),
			);

			await waitFor(() => expect(tab.location.href).toBe("blob:cv-1"));
			const blob = createObjectURL.mock.calls[0][0];
			expect(blob.type).toBe("application/pdf");
			expect(await blob.text()).toBe("%PDF-1.4 fake");
			expect(tab.close).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
			expect(screen.getByRole("button", { name: "Open CV" })).toHaveProperty("disabled", false);

			// The temporary link is dropped after a minute.
			expect(revokeObjectURL).not.toHaveBeenCalled();
			await act(() => vi.advanceTimersByTimeAsync(CV_URL_REVOKE_MS / 2));
			expect(revokeObjectURL).not.toHaveBeenCalled();
			await act(() => vi.advanceTimersByTimeAsync(CV_URL_REVOKE_MS / 2));
			expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cv-1");
		});

		it("downloads the PDF instead when the browser blocks the tab", async () => {
			open.mockReturnValue(null);
			const clicked: { href: string; download: string; attached: boolean }[] = [];
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(function (this: HTMLAnchorElement) {
					clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
				});
			try {
				renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
				fireEvent.click(await screen.findByRole("button", { name: "Open CV" }));

				await waitFor(() => expect(clicked).toHaveLength(1));
				expect(clicked[0]).toEqual({ href: "blob:cv-1", download: "grace_turner.pdf", attached: true });
				// The link is only there for the click.
				expect(document.querySelector("a[download]")).toBeNull();
				expect(screen.queryByRole("alert")).toBeNull();
			} finally {
				click.mockRestore();
			}
		});

		it("closes the tab and says so when the CV can't be fetched, and tries again on the next click", async () => {
			const answer = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) =>
				url.endsWith("/cv") && cvRequests().length <= 1
					? Promise.resolve(apiError(404, "file_missing", "The CV file is missing"))
					: answer(url, init),
			);
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			fireEvent.click(await screen.findByRole("button", { name: "Open CV" }));

			expect((await screen.findByRole("alert")).textContent).toBe("✕ We couldn't open the CV. Try again.");
			expect(tab.close).toHaveBeenCalledOnce();
			expect(createObjectURL).not.toHaveBeenCalled();
			expect(tab.location.href).toBe("");

			fireEvent.click(screen.getByRole("button", { name: "Open CV" }));
			await waitFor(() => expect(tab.location.href).toBe("blob:cv-1"));
			expect(screen.queryByRole("alert")).toBeNull();
		});

		it("is there for members too", async () => {
			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			fireEvent.click(await screen.findByRole("button", { name: "Open CV" }));
			await waitFor(() => expect(tab.location.href).toBe("blob:cv-1"));
		});

		it("opens with O, and from the menu", async () => {
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await screen.findByRole("button", { name: "Open CV" });

			fireEvent.keyDown(document.body, { key: "o" });
			expect(open).toHaveBeenCalledExactlyOnceWith("", "_blank");
			await waitFor(() => expect(tab.location.href).toBe("blob:cv-1"));

			fireEvent.click(screen.getByRole("button", { name: "More actions for Grace Turner" }));
			fireEvent.click(await screen.findByRole("menuitem", { name: /Open CV in a new tab/ }));
			expect(open).toHaveBeenCalledTimes(2);
			await waitFor(() => expect(cvRequests()).toHaveLength(2));
		});

		it("shows the PDF on the CV tab on a computer, and lets go of it when the page closes", async () => {
			// A mouse and a keyboard: the browser can show the PDF inside the page.
			vi.stubGlobal("matchMedia", (query: string) => ({
				matches: query === "(hover: hover) and (pointer: fine)",
				media: query,
				onchange: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false,
			}));
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			// Nothing is fetched until the tab is opened.
			fireEvent.click(await screen.findByRole("tab", { name: "CV" }));
			expect(screen.getByText("Loading the CV").getAttribute("role")).toBe("status");

			const frame = (await screen.findByTitle("CV of Grace Turner")) as HTMLIFrameElement;
			expect(frame.tagName).toBe("IFRAME");
			expect(frame.getAttribute("src")).toBe("blob:cv-1#view=FitH");
			expect(cvRequests()).toHaveLength(1);
			expect(cvRequests()[0][1]).toEqual(expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }));
			// Showing it opens no tab.
			expect(open).not.toHaveBeenCalled();
			expect(revokeObjectURL).not.toHaveBeenCalled();

			cleanup();
			expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cv-1");
		});
	});
});

describe("requirements", () => {
	const swift = { id: "r1", label: "Swift", detail: "Several years of Swift in production", weight: "must" } as const;
	const swiftUi = { id: "r2", label: "SwiftUI", detail: "Shipped a live app built with SwiftUI", weight: "must" } as const;
	const kotlin = { id: "r3", label: "Kotlin MP", detail: "Code shared with Android", weight: "nice" } as const;
	const rubric = (): RubricItem[] => [{ ...swift }, { ...swiftUi }, { ...kotlin }];
	const requirementsJob = (fields: Partial<FakeJob> = {}): FakeJob => ({
		id: "job_1",
		title: "Senior iOS Engineer",
		description: "Swift, SwiftUI, 5 years.",
		status: "open",
		cvCount: 3,
		createdAt: "2026-10-22T12:00:00Z",
		updatedAt: "2026-10-22T12:00:00Z",
		rubric: rubric(),
		rubricStatus: "ready",
		...fields,
	});
	type Level = "clear" | "partial" | "none" | null;
	// A scored CV with its level for Swift, SwiftUI and Kotlin MP, scored by the shared formula as the API does.
	const cv = (id: string, name: string, levels: [Level, Level, Level], fields: Partial<FakeCandidate> = {}) => {
		const evidence = rubric().map(({ id: requirement, label, detail, weight }, index) => ({
			id: requirement,
			label,
			detail,
			weight,
			level: levels[index],
			quote: levels[index] === "clear" || levels[index] === "partial" ? `${name} on ${label}` : "",
		}));
		const checks = evidence.map(({ id: requirement, label, weight, level }) => ({ id: requirement, label, weight, level }));
		return fakeCandidate({
			id,
			name,
			fileName: `${id}.pdf`,
			evidence,
			score: scoreChecks(checks),
			matches: matchLabels(checks),
			gaps: gapLabels(checks),
			scoredAt: `2026-10-22T12:0${candidates.length}:00Z`,
			...fields,
		});
	};
	// With Kotlin MP as a nice-to-have: Grace 86, Kenji 79, Rayan 36. As a must-have: Kenji 83, Grace 67, Rayan 50.
	const threeCvs = () => [
		cv("cand_grace", "Grace Turner", ["clear", "clear", "none"]),
		cv("cand_kenji", "Kenji Sato", ["clear", "partial", "clear"]),
		cv("cand_rayan", "Rayan Haddad", ["partial", "none", "clear"]),
	];
	// The names in the live ranking beside the requirements, best first.
	const ranking = () =>
		within(screen.getByRole("list", { name: "Ranking" }))
			.getAllByRole("listitem")
			.map((row) => within(row).getByRole("link").textContent?.replace(/^Rank \d+:\s*/, ""));
	const weightOf = async (label: string) => within(await screen.findByRole("radiogroup", { name: label }));
	const isRubricPatch = (url: string, init?: RequestInit) => init?.method === "PATCH" && url.endsWith("/jobs/job_1/rubric");
	const patches = () =>
		fetchMock.mock.calls
			.filter(([url, init]) => isRubricPatch(url, init))
			.map(([, init]) => JSON.parse(String(init?.body)) as { changes: unknown[] });

	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
		jobs = [requirementsJob()];
		candidates = threeCvs();
	});

	it("puts the requirements in their own tab, with the weights explained and the ranking beside them", async () => {
		renderAt("/dashboard/jobs/job_1");
		fireEvent.click(await screen.findByRole("tab", { name: /^Requirements\s*3$/ }));

		const list = within(await screen.findByRole("list", { name: "Requirements" }));
		expect(list.getAllByRole("listitem").map((item) => item.querySelector("[id]")?.textContent)).toEqual([
			"Swift",
			"SwiftUI",
			"Kotlin MP",
		]);
		expect(list.getByText("Code shared with Android")).toBeTruthy();
		expect((await weightOf("Kotlin MP")).getByRole("radio", { name: "Nice" })).toHaveProperty("checked", true);
		expect(screen.getByText(/Must counts three times as much as Nice, and Off doesn't count/)).toBeTruthy();
		expect(screen.getByText(/re-ranks at once: no AI, no waiting/)).toBeTruthy();
		expect(screen.getByText("3 of 15 requirements · 2 must · 1 nice · 0 off")).toBeTruthy();
		expect(ranking()).toEqual(["Grace Turner", "Kenji Sato", "Rayan Haddad"]);
		expect(screen.getByText("Grace Turner leads with 86.")).toBeTruthy();
		// Partial is explained once, in the key.
		expect(screen.getByText("Partial: the CV shows part of it")).toBeTruthy();
	});

	it("re-ranks every CV the moment a weight changes, before the API answers", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		const kotlinWeight = await weightOf("Kotlin MP");
		const held = hold(isRubricPatch);

		fireEvent.click(kotlinWeight.getByRole("radio", { name: "Must" }));
		expect(ranking()).toEqual(["Kenji Sato", "Grace Turner", "Rayan Haddad"]);
		expect(screen.getByText("Kenji Sato leads with 83.")).toBeTruthy();
		await waitFor(() => expect(kotlinWeight.getByRole("radio", { name: "Must" })).toHaveProperty("checked", true));
		expect(held.pending()).toBe(1);
		expect(patches()).toEqual([{ changes: [{ id: "r3", weight: "must" }] }]);

		held.release();
		await waitFor(() => expect(jobs[0].rubric?.[2].weight).toBe("must"));
		await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/jobs/job_1/candidates")).length).toBeGreaterThan(1));
		expect(ranking()).toEqual(["Kenji Sato", "Grace Turner", "Rayan Haddad"]);

		// The Candidates tab has the same order, and the scores to match.
		fireEvent.click(screen.getByRole("tab", { name: /^Candidates/ }));
		const rows = within(await screen.findByRole("list", { name: "Candidates" })).getAllByRole("link");
		expect(rows.map((row) => row.textContent?.match(/(Grace Turner|Kenji Sato|Rayan Haddad)/)?.[1])).toEqual([
			"Kenji Sato",
			"Grace Turner",
			"Rayan Haddad",
		]);
		expect(rows[0].textContent).toMatch(/Score 83$/);
	});

	it("puts the order back and says why when the API refuses a change", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		const kotlinWeight = await weightOf("Kotlin MP");
		const held = hold(isRubricPatch);
		rubricRefusal = apiError(409, "rubric_not_ready", "The requirements aren't ready.");

		fireEvent.click(kotlinWeight.getByRole("radio", { name: "Must" }));
		expect(ranking()).toEqual(["Kenji Sato", "Grace Turner", "Rayan Haddad"]);
		await waitFor(() => expect(held.pending()).toBe(1));

		held.release();
		expect(await screen.findByText("wasn't saved")).toBeTruthy();
		expect(screen.getByText(/can't be changed right now/)).toBeTruthy();
		expect(ranking()).toEqual(["Grace Turner", "Kenji Sato", "Rayan Haddad"]);
		expect(screen.getByText("Grace Turner leads with 86.")).toBeTruthy();
		await waitFor(() => expect(kotlinWeight.getByRole("radio", { name: "Nice" })).toHaveProperty("checked", true));
	});

	it("folds quick clicks into one more request, so the API ends where the page does", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		const kotlinWeight = await weightOf("Kotlin MP");
		const swiftWeight = await weightOf("Swift");
		const held = hold(isRubricPatch);

		fireEvent.click(kotlinWeight.getByRole("radio", { name: "Must" }));
		await waitFor(() => expect(held.pending()).toBe(1));
		fireEvent.click(kotlinWeight.getByRole("radio", { name: "Off" }));
		fireEvent.click(swiftWeight.getByRole("radio", { name: "Nice" }));
		fireEvent.click(kotlinWeight.getByRole("radio", { name: "Nice" }));
		expect(patches()).toHaveLength(1);

		held.release();
		await waitFor(() => expect(held.pending()).toBe(1));
		expect(patches()[1]).toEqual({
			changes: [
				{ id: "r3", weight: "nice" },
				{ id: "r1", weight: "nice" },
			],
		});
		// The first answer (Kotlin MP as a must-have) doesn't flash back while the second is on its way.
		expect(kotlinWeight.getByRole("radio", { name: "Nice" })).toHaveProperty("checked", true);

		held.release();
		await waitFor(() => expect(jobs[0].rubric?.map(({ weight }) => weight)).toEqual(["nice", "must", "nice"]));
		await waitFor(() => expect(swiftWeight.getByRole("radio", { name: "Nice" })).toHaveProperty("checked", true));
		expect(kotlinWeight.getByRole("radio", { name: "Nice" })).toHaveProperty("checked", true);
		expect(patches()).toHaveLength(2);
	});

	it("adds a requirement that every CV shows as not checked, then checks them all", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		fireEvent.click(await screen.findByRole("button", { name: "Add requirement" }));
		const dialog = within(await screen.findByRole("dialog", { name: "Add a requirement" }));
		expect(dialog.getByText(/starts as not checked on every CV/)).toBeTruthy();
		expect(dialog.getByText(/This job has 3 of 15/)).toBeTruthy();

		// The same rules as the API, before anything is sent.
		fireEvent.click(dialog.getByRole("button", { name: "Add requirement" }));
		expect(await dialog.findByText("✕ Enter a name for this requirement")).toBeTruthy();
		fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Accessibility" } });
		expect(dialog.getByText("13 / 40")).toBeTruthy();
		fireEvent.change(dialog.getByLabelText("What a CV should show"), { target: { value: "VoiceOver and Dynamic Type work" } });
		fireEvent.click(within(dialog.getByRole("radiogroup", { name: "How much it counts" })).getByRole("radio", { name: "Must" }));
		fireEvent.click(dialog.getByRole("button", { name: "Add requirement" }));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(await screen.findByText(/Added “Accessibility”/)).toBeTruthy();
		expect(jobs[0].rubric?.at(-1)).toMatchObject({ label: "Accessibility", detail: "VoiceOver and Dynamic Type work", weight: "must" });
		const rows = within(screen.getByRole("list", { name: "Ranking" })).getAllByRole("listitem");
		for (const row of rows) expect(within(row).getByRole("img", { name: "Accessibility: not checked" })).toBeTruthy();
		expect(await screen.findByText("3 CVs not checked against all requirements.")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Check all" }));
		const confirm = within(await screen.findByRole("alertdialog", { name: "Check 3 CVs against every requirement?" }));
		expect(confirm.getByText(/one AI read per CV/)).toBeTruthy();
		fireEvent.click(confirm.getByRole("button", { name: "Check all CVs" }));

		expect(await screen.findByText(/Checking 3 CVs against every requirement…/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Check all" })).toHaveProperty("disabled", true);
		expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "POST" && url.endsWith("/rubric/check"))).toBe(true);
		fireEvent.click(screen.getByRole("tab", { name: /^Candidates/ }));
		expect(await screen.findAllByText("Checking…")).toHaveLength(3);
	});

	it("renames a requirement in place and removes one after asking, from the keyboard", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		fireEvent.click(await screen.findByRole("button", { name: "Rename SwiftUI" }));
		const field = screen.getByRole("textbox", { name: "New name for SwiftUI" });
		expect(document.activeElement).toBe(field);
		fireEvent.change(field, { target: { value: "  " } });
		fireEvent.submit(field);
		expect(await screen.findByText("✕ Enter a name for this requirement")).toBeTruthy();
		fireEvent.change(field, { target: { value: "SwiftUI apps" } });
		fireEvent.submit(field);
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename SwiftUI apps" })));
		await waitFor(() => expect(jobs[0].rubric?.[1].label).toBe("SwiftUI apps"));

		// Escape puts the name back.
		fireEvent.click(screen.getByRole("button", { name: "Rename Swift" }));
		fireEvent.change(screen.getByRole("textbox", { name: "New name for Swift" }), { target: { value: "Objective-C" } });
		fireEvent.keyDown(screen.getByRole("textbox", { name: "New name for Swift" }), { key: "Escape" });
		expect(screen.getByRole("button", { name: "Rename Swift" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove Kotlin MP" }));
		const confirm = within(await screen.findByRole("alertdialog", { name: "Remove “Kotlin MP”?" }));
		fireEvent.click(confirm.getByRole("button", { name: "Remove requirement" }));
		await waitFor(() => expect(screen.getAllByRole("radiogroup")).toHaveLength(2));
		expect(await screen.findByText(/Removed “Kotlin MP”/)).toBeTruthy();
		expect(screen.getByText("Grace Turner leads with 100.")).toBeTruthy();
		await waitFor(() => expect(jobs[0].rubric?.[2]).toMatchObject({ id: "r3", removed: true }));
		expect(screen.getByRole("tab", { name: /^Requirements\s*2$/ })).toBeTruthy();
	});

	it("asks before redrafting, saying new requirements will need checking", async () => {
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		fireEvent.click(await screen.findByRole("button", { name: "Redraft from description" }));
		const confirm = within(await screen.findByRole("alertdialog", { name: "Redraft the requirements?" }));
		expect(confirm.getByText(/new ones start as not checked, so the CVs will need checking against them/)).toBeTruthy();
		fireEvent.click(confirm.getByRole("button", { name: "Redraft" }));

		expect(await screen.findByText("Drafting requirements from the description…")).toBeTruthy();
		expect(jobs[0].rubricStatus).toBe("drafting");
	});

	it("offers to set requirements up, says so while they draft, and shows them when they land", async () => {
		jobs = [requirementsJob({ rubric: null, rubricStatus: "none" })];
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		expect(await screen.findByRole("heading", { name: "Set up this job's requirements" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Set up requirements" }));

		expect(await screen.findByText("Drafting requirements from the description…")).toBeTruthy();
		// The draft lands; the job is asked again every few seconds while it drafts.
		jobs[0].rubric = rubric();
		jobs[0].rubricStatus = "ready";
		expect(await screen.findByRole("list", { name: "Requirements" }, { timeout: 8000 })).toBeTruthy();
	}, 15_000);

	it("shows the failed state when the draft couldn't even start, and says so if trying again fails too", async () => {
		jobs = [requirementsJob({ rubric: null, rubricStatus: "none" })];
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (init?.method !== "POST" || !url.endsWith("/rubric/draft")) return answer(url, init);
			jobs[0].rubricStatus = "failed";
			return Response.json({ job: withCount(jobs[0]) }, { status: 202 });
		});
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		fireEvent.click(await screen.findByRole("button", { name: "Set up requirements" }));
		expect(await screen.findByText("✕ We couldn't draft the requirements")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText("✕ It didn't start this time either. Try again in a minute.")).toBeTruthy();
	});

	it("says when the draft failed, and tries again", async () => {
		jobs = [requirementsJob({ rubric: null, rubricStatus: "failed" })];
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		expect(await screen.findByText("✕ We couldn't draft the requirements")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText("Drafting requirements from the description…")).toBeTruthy();
	});

	it("says in plain words when the hour's AI requests have run out", async () => {
		jobs = [requirementsJob({ rubric: null, rubricStatus: "none" })];
		rubricRefusal = apiError(429, "rate_limited", "That's 10 AI requests this minute. Try again in a minute.");
		renderAt("/dashboard/jobs/job_1?tab=requirements");
		fireEvent.click(await screen.findByRole("button", { name: "Set up requirements" }));
		expect(await screen.findByText("✕ That's 10 AI requests this minute. Try again in a minute.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Set up requirements" })).toBeTruthy();
		expect(jobs[0].rubricStatus).toBe("none");
	});

	it("shows a square per requirement on each row, named for screen readers, and dims an Off one", async () => {
		jobs = [requirementsJob({ rubric: [{ ...swift }, { ...swiftUi }, { ...kotlin, weight: "off" }] })];
		candidates = threeCvs().map((candidate) => ({
			...candidate,
			evidence: candidate.evidence?.map((entry) => (entry.id === "r3" ? { ...entry, weight: "off" as const } : entry)) ?? null,
		}));
		renderAt("/dashboard/jobs/job_1");
		const list = within(await screen.findByRole("list", { name: "Candidates" }));
		const kenji = list.getAllByRole("listitem").find((row) => row.textContent?.includes("Kenji Sato"));
		const squares = within(kenji!).getAllByRole("img");
		expect(squares.map((square) => square.getAttribute("aria-label"))).toEqual([
			"Swift: clear",
			"SwiftUI: partial",
			"Kotlin MP: clear, off",
		]);
		expect(squares[2].className).toMatch(/opacity-30/);
	});

	it("tags a CV scored before the job had requirements and keeps its score, leaving Re-read to its page", async () => {
		candidates = [
			...threeCvs(),
			fakeCandidate({ id: "cand_old", name: "Ola Berg", score: 80, scoredBeforeRequirements: true, canRetry: true, scoredAt: "2026-10-21T12:00:00Z" }),
		];
		renderAt("/dashboard/jobs/job_1");
		const list = within(await screen.findByRole("list", { name: "Candidates" }));
		const old = list.getAllByRole("listitem").find((row) => row.textContent?.includes("Ola Berg"))!;
		expect(within(old).getByText("Scored before requirements were set")).toBeTruthy();
		expect(within(old).queryAllByRole("img")).toHaveLength(0);
		expect(within(old).getByRole("link").textContent).toMatch(/Score 80$/);

		expect(within(old).queryByRole("button")).toBeNull();
	});

	it("shows each requirement on the candidate page with its weight, level and the line from the CV", async () => {
		jobs = [requirementsJob({ rubric: [...rubric(), { id: "r4", label: "GraphQL", detail: "Has used GraphQL", weight: "off" }] })];
		candidates = [
			cv("cand_kenji", "Kenji Sato", ["clear", "partial", null], {
				rank: 2,
				rankedCount: 3,
				evidence: [
					{ id: "r1", label: "Swift", detail: "Several years of Swift in production", weight: "must", level: "clear", quote: "Six years of Swift" },
					{ id: "r2", label: "SwiftUI", detail: "Shipped a live app built with SwiftUI", weight: "must", level: "partial", quote: "A SwiftUI prototype" },
					{ id: "r3", label: "Kotlin MP", detail: "Code shared with Android", weight: "nice", level: null, quote: "" },
					{ id: "r4", label: "GraphQL", detail: "Has used GraphQL", weight: "off", level: "none", quote: "" },
				],
			}),
		];
		renderAt("/dashboard/jobs/job_1/candidates/cand_kenji");

		const must = within(await screen.findByRole("region", { name: "Must-haves" }));
		expect(must.getByText("Clear")).toBeTruthy();
		expect(must.getByText("“Six years of Swift”")).toBeTruthy();
		expect(must.getByText("Partial")).toBeTruthy();
		expect(must.getByText("“A SwiftUI prototype”")).toBeTruthy();
		const nice = within(screen.getByRole("region", { name: "Nice to have" }));
		expect(nice.getByText("Not checked")).toBeTruthy();
		expect(nice.getByText(/Not checked yet/)).toBeTruthy();
		const off = within(screen.getByRole("region", { name: "Off, not counted" }));
		expect(off.getByText("None")).toBeTruthy();
		expect(off.getByText("GraphQL").className).toMatch(/text-ink-muted/);
		expect(screen.getByText("Must-haves 1 of 2, 1 partial · Nice to have 0 of 1")).toBeTruthy();
		expect(screen.getByText("1 of 3 requirements met · 1 partly")).toBeTruthy();
	});

	it("says on the candidate page when a CV was scored before the requirements, with what it was scored on", async () => {
		candidates = [
			fakeCandidate({
				id: "cand_old",
				name: "Ola Berg",
				score: 80,
				rank: 1,
				rankedCount: 1,
				scoredBeforeRequirements: true,
				canRetry: true,
				legacyRequirements: [
					{ label: "Swift", requirement: "Swift in production", importance: "must", met: true, evidence: "Five years of Swift" },
					{ label: "Kotlin MP", requirement: "Kotlin Multiplatform", importance: "nice", met: false, evidence: "" },
				],
			}),
		];
		renderAt("/dashboard/jobs/job_1/candidates/cand_old");

		expect(await screen.findByRole("heading", { name: "Scored before this job's requirements were set" })).toBeTruthy();
		expect(screen.getByText(/keeps its score and place until you re-read it/)).toBeTruthy();
		expect(within(screen.getByRole("region", { name: "Must-haves" })).getByText("“Five years of Swift”")).toBeTruthy();
		expect(within(screen.getByRole("region", { name: "Nice to have" })).getByText("✕ Kotlin MP")).toBeTruthy();
		expect(screen.getByText("1 of 2 requirements met")).toBeTruthy();
		fireEvent.click(screen.getAllByRole("button", { name: "Re-read" })[0]);
		await waitFor(() => expect(candidates[0].status).toBe("queued"));
	});
});
