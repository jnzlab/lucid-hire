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
import { createAppRouter } from "./router.ts";

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
	RedirectToSignIn: ({ redirectUrl }: { redirectUrl?: string }) => <p data-redirect-url={redirectUrl}>Redirecting to sign in</p>,
	UserButton: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
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
};
type FakeCandidate = Candidate & { jobId: string };
let org: Org | null;
let jobs: FakeJob[];
let candidates: FakeCandidate[];
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const notFound = () => Response.json({ error: { message: "That job doesn't exist or isn't yours" } }, { status: 404 });
const apiError = (status: number, code: string, message: string) =>
	Response.json({ error: { code, message } }, { status });
// What the API sends for a job: the CV count is always there.
const withCount = (job: FakeJob) => ({ ...job, slug: `${job.id}-slug`, hasCover: job.hasCover ?? false, cvCount: job.cvCount ?? 0 });

// The jobs API, enough of it for the pages: list, create, read, edit, delete and the AI rewrite.
function fakeJobs(path: string, method: string, body: Record<string, string>): Response {
	const id = path.split("/")[2];
	const job = jobs.find((candidate) => candidate.id === id);
	if (path === "/jobs" && method === "GET") {
		return Response.json({
			jobs: jobs.map(({ id, title, status, cvCount, createdAt, updatedAt }) => ({
				id,
				title,
				status,
				cvCount: cvCount ?? 0,
				createdAt,
				updatedAt,
			})),
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
	if (path === "/jobs/enhance") {
		return Response.json({ description: `What you need:\n- ${body.description}` });
	}
	if (!job) return notFound();
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

// A candidate as the list shows it, without the fields only the candidate page needs.
const summary = ({
	jobId: _jobId,
	summary: _summary,
	requirements: _requirements,
	fileSize: _size,
	note: _note,
	decidedAt: _decidedAt,
	...rest
}: FakeCandidate) => rest;
const forPage = ({ jobId: _jobId, ...rest }: FakeCandidate): Candidate => rest;
// Scored first (best first), then the ones being read, then the failed, as the API orders them.
const place = (candidate: FakeCandidate) => ({ scored: 0, queued: 1, scoring: 1, failed: 2 })[candidate.status];

// The candidates API: the ranked list, upload (the raw PDF as the body), read, decide, the CV file, retry and
// admin-only delete.
function fakeCandidates(url: URL, init: RequestInit | undefined): Response {
	const [, , jobId, , id, action] = url.pathname.split("/");
	const method = init?.method ?? "GET";
	const job = jobs.find((candidate) => candidate.id === jobId);
	if (!job) return notFound();

	if (!id) {
		if (method === "GET") {
			const ranked = candidates
				.filter((candidate) => candidate.jobId === jobId)
				.toSorted(
					(a, b) =>
						place(a) - place(b) ||
						(a.status === "scored" ? (b.score ?? 0) - (a.score ?? 0) : a.createdAt.localeCompare(b.createdAt)),
				);
			return Response.json({ candidates: ranked.map(summary), cvCount: job.cvCount ?? 0, cvLimit: 10 });
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
		// A CV that failed can be retried while it has runs left; so can one stuck in the queue.
		if (found.status === "scored") return apiError(409, "not_failed", "Only a CV that failed can be retried");
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
		status: "scored",
		decision: "undecided",
		name: null,
		headline: null,
		score: null,
		matches: [],
		gaps: [],
		error: null,
		canRetry: false,
		createdAt: "2026-10-22T12:00:00Z",
		scoredAt: null,
		summary: null,
		requirements: null,
		fileSize: 120_000,
		note: null,
		decidedAt: null,
		...fields,
	};
}

// The Markdown renderer is loaded on demand; loading it once up front keeps the first test from racing the import.
beforeAll(() => import("./components/markdown.tsx"), 60_000);

beforeEach(() => {
	session.signedIn = true;
	org = null;
	jobs = [];
	candidates = [];
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		// Uploads send a file, not JSON.
		const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, string>) : {};
		if (path === "/me") return Response.json({ userId: "user_1", org });
		if (path === "/orgs" && method === "POST") {
			org = { id: "org_1", name: body.name, role: "admin" };
			return Response.json({ org }, { status: 201 });
		}
		if (/^\/jobs\/[^/]+\/candidates/.test(path)) return fakeCandidates(new URL(url), init);
		if (path.startsWith("/jobs")) return fakeJobs(path, method, body);
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
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

		expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
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

describe("jobs", () => {
	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
	});

	it("shows the candidate view beside the form, live, with Compose and Preview tabs", async () => {
		renderAt("/dashboard/jobs/new");
		const title = await screen.findByLabelText("Job title");
		expect(screen.getByRole("heading", { level: 2, name: "Candidate view" })).toBeTruthy();
		expect(screen.getByText("Your description appears here as you type. Markdown works.")).toBeTruthy();

		fireEvent.change(title, { target: { value: "Preview role" } });
		fireEvent.change(screen.getByLabelText("Description"), { target: { value: "## Duties\n\nShip **fast**." } });
		const view = screen.getByRole("heading", { level: 2, name: "Candidate view" }).closest("section")!;
		expect(within(view).getByText("Preview role")).toBeTruthy();
		expect(await within(view).findByRole("heading", { level: 2, name: "Duties" })).toBeTruthy();
		expect(within(view).getByText("fast").tagName).toBe("STRONG");

		const compose = screen.getByRole("tab", { name: "Compose" });
		const preview = screen.getByRole("tab", { name: "Preview" });
		expect(compose.getAttribute("aria-selected")).toBe("true");
		fireEvent.click(preview);
		expect(preview.getAttribute("aria-selected")).toBe("true");
		expect(compose.getAttribute("aria-selected")).toBe("false");
		// The typed text is still there when switching back.
		fireEvent.click(compose);
		expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("Preview role");
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
		const router = renderAt("/dashboard");

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
		expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
		expect(await screen.findByText("Swift, SwiftUI, 5 years.")).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/jobs",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ title: "Sprite test role", description: "Swift, SwiftUI, 5 years.", status: "open" }),
			}),
		);

		fireEvent.click(screen.getByRole("link", { name: /Jobs/ }));
		expect(await screen.findByRole("link", { name: /Sprite test role/ })).toBeTruthy();
	});

	it("offers Post a job on the list once there are jobs, and Post your first job before", async () => {
		jobs = [];
		renderAt("/dashboard");
		expect(await screen.findByRole("link", { name: /Post your first job/ })).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Post a job/ })).toBeNull();
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
		const router = renderAt("/dashboard");
		const post = await screen.findByRole("link", { name: /Post a job/ });
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
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(description.value).toBe("swift 5y");

		fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
		expect(await screen.findByRole("heading", { level: 1, name: "iOS Engineer" })).toBeTruthy();
		expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
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

		fireEvent.click(await screen.findByRole("link", { name: "Edit job" }));
		const title = await screen.findByLabelText("Job title");
		fireEvent.change(title, { target: { value: "Data Scientist" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Data Scientist" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/jobs/job_7");

		fireEvent.click(screen.getByRole("button", { name: "Close job" }));
		expect(await screen.findByRole("button", { name: /Reopen job/ })).toBeTruthy();
		expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
		expect((await screen.findByText("Job closed")).getAttribute("aria-live")).toBe("polite");

		fireEvent.click(screen.getByRole("button", { name: /Reopen job/ }));
		expect(await screen.findByText("Job reopened")).toBeTruthy();
		expect(screen.queryByText("Job closed")).toBeNull();
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
		const router = renderAt("/dashboard");

		fireEvent.click(await screen.findByRole("link", { name: /Sprite test role/ }));
		fireEvent.click(await screen.findByRole("button", { name: "Delete job" }));
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
		expect(router.state.location.pathname).toBe("/dashboard");
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
		expect(screen.queryByRole("button", { name: "Delete job" })).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/missing");
		expect(await screen.findByText(/This job doesn't exist/)).toBeTruthy();
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
		expect(router.state.location.pathname).toBe("/dashboard");
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(confirm).not.toHaveBeenCalled();
	});

	it("lets a form nobody has typed in go at once, by Cancel or any other link", async () => {
		const router = renderAt("/dashboard/jobs/new");
		fireEvent.click(await screen.findByRole("link", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { level: 1, name: "Jobs" })).toBeTruthy();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(router.state.location.pathname).toBe("/dashboard");
	});

	it("asks before any link leaves an edited job, and lets go once the edit is undone", async () => {
		const router = renderAt("/dashboard/jobs/job_7/edit");
		const title = (await screen.findByLabelText("Job title")) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "Data Scientist" } });

		fireEvent.click(screen.getByRole("link", { name: "LucidHire dashboard" }));
		expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		await dialogGone();
		fireEvent.click(screen.getByRole("link", { name: /Jobs/ }));
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

	it("never holds back a save: Open job, Save as draft and Save changes go straight through", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

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
		renderAt("/dashboard");

		const heading = await screen.findByRole("heading", { level: 1, name: "Jobs" });
		await waitFor(() => expect(document.activeElement).toBe(heading));
		expect(heading.getAttribute("tabindex")).toBe("-1");
		expect(heading.className).toContain("focus:outline-none");

		fireEvent.click(screen.getByRole("link", { name: /Kept role/ }));
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
		renderAt("/dashboard");
		expect(await screen.findByRole("heading", { level: 2, name: "✕ We couldn't load your jobs" })).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	});

	it("says in plain words when the API can't be reached or has nothing to say", async () => {
		failRequests((url) => url.endsWith("/jobs"), async () => Promise.reject(new TypeError("Failed to fetch")));
		renderAt("/dashboard");
		expect(await screen.findByText("We couldn't reach LucidHire. Check your connection and try again.")).toBeTruthy();
		expect(screen.queryByText(/Failed to fetch/)).toBeNull();
		cleanup();

		failRequests((url) => url.endsWith("/jobs"), async () => new Response("<html>Bad gateway</html>", { status: 502 }));
		renderAt("/dashboard");
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
			renderAt("/dashboard");

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
		const draft = screen.getByRole("button", { name: "Save as draft" }) as HTMLButtonElement;
		draft.focus();

		fireEvent.click(draft);
		await waitFor(() => expect(saving.pending()).toBe(1));
		expect(draft.getAttribute("aria-disabled")).toBe("true");
		expect(draft.disabled).toBe(false);
		expect(document.activeElement).toBe(draft);
		// Neither button saves it a second time while it is busy.
		fireEvent.click(draft);
		fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
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
		const close = (await screen.findByRole("button", { name: "Close job" })) as HTMLButtonElement;
		close.focus();
		const saving = hold((_url, init) => init?.method === "PATCH");

		fireEvent.click(close);
		await waitFor(() => expect(saving.pending()).toBe(1));
		expect(close.textContent).toBe("Saving");
		expect(close.getAttribute("aria-disabled")).toBe("true");
		expect(close.disabled).toBe(false);
		expect(document.activeElement).toBe(close);
		fireEvent.click(close);
		expect(saving.pending()).toBe(1);

		await act(async () => saving.release());
		expect(await screen.findByText("Job closed")).toBeTruthy();
		expect(close.textContent).toBe("Reopen job");
		expect(close.getAttribute("aria-disabled")).toBe("false");
	});
});

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
			requirements: [
				{ label: "Kotlin MP", requirement: "Kotlin Multiplatform", importance: "must", met: false, evidence: "" },
				{
					label: "SwiftUI",
					requirement: "Shipped SwiftUI apps",
					importance: "must",
					met: true,
					evidence: "Built the SwiftUI app used by 2M customers",
				},
				{
					label: "Instruments",
					requirement: "Profiling with Instruments",
					importance: "nice",
					met: true,
					evidence: "Cut launch time 40% using Instruments",
				},
				{ label: "Accessibility", requirement: "Accessibility work", importance: "nice", met: false, evidence: "" },
			],
			...fields,
		});

	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
		jobs = [openJob()];
	});

	it("uploads two PDFs to an open job, and they appear in the list", async () => {
		renderAt("/dashboard/jobs/job_1");

		const input = (await screen.findByLabelText("Choose PDFs")) as HTMLInputElement;
		expect(input.type).toBe("file");
		expect(input.accept).toBe("application/pdf");
		expect(input.multiple).toBe(true);
		expect(await screen.findByText("0 of 10 free CVs used")).toBeTruthy();

		const files = [pdf("grace_turner.pdf"), pdf("kenji tanaka.pdf")];
		fireEvent.change(input, { target: { files } });

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

	it("calls the upload zone Add CVs on a phone, and keeps the Choose PDFs button", async () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query === "(pointer: coarse)",
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		renderAt("/dashboard/jobs/job_1");

		expect(await screen.findByText("Add CVs")).toBeTruthy();
		expect(screen.queryByText("Drop CVs here")).toBeNull();
		expect(screen.getByLabelText("Choose PDFs")).toBeTruthy();
	});

	it("takes PDFs dropped on the zone", async () => {
		renderAt("/dashboard/jobs/job_1");

		const zone = await screen.findByText("Drop CVs here");
		// The page has to cancel dragover, or the browser opens the PDF itself.
		expect(fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } })).toBe(false);
		fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [pdf("dropped.pdf")] } });

		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(within(screen.getByRole("list", { name: "Candidates" })).getByText("dropped.pdf")).toBeTruthy();
	});

	it("turns away a file that is not a PDF, is empty or is over 5 MB, without sending it", async () => {
		renderAt("/dashboard/jobs/job_1");

		fireEvent.change(await screen.findByLabelText("Choose PDFs"), {
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

		const input = await screen.findByLabelText("Choose PDFs");
		fireEvent.change(input, { target: { files: [pdf("ninth.pdf"), pdf("tenth.pdf")] } });

		expect(await screen.findByText("1 uploaded · 1 not uploaded")).toBeTruthy();
		expect(screen.getByText("✕ This job has used its 10 free CVs")).toBeTruthy();
		expect(screen.getByText("10 of 10 free CVs used")).toBeTruthy();
		expect(uploads()).toHaveLength(1);
		// Nothing left to take, so the chooser gives way to a note.
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(screen.getByText("This job has used its 10 free CVs.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
		expect(screen.queryByText("1 uploaded · 1 not uploaded")).toBeNull();
		// There is no chooser to go to, so focus lands on the note.
		expect(document.activeElement).toBe(screen.getByText("This job has used its 10 free CVs."));
	});

	it("moves focus to Choose PDFs when the results are cleared", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = await screen.findByLabelText("Choose PDFs");
		fireEvent.change(input, { target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] } });

		const clear = await screen.findByRole("button", { name: "Clear list" });
		clear.focus();
		fireEvent.click(clear);

		expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
		expect(document.activeElement).toBe(input);
	});

	it("says so under the upload zone when a job has no candidates yet, until one goes up", async () => {
		renderAt("/dashboard/jobs/job_1");

		const empty = await screen.findByText("No candidates yet. Uploaded CVs are ranked here.");
		expect(screen.getByText("Drop CVs here").compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Choose PDFs"), { target: { files: [pdf("one.pdf")] } });
		expect(await screen.findByText("1 CV uploaded")).toBeTruthy();
		expect(screen.queryByText("No candidates yet. Uploaded CVs are ranked here.")).toBeNull();
	});

	it("shows the API's reason when it refuses a file, and doesn't send the rest of the batch", async () => {
		jobs = [openJob({ cvCount: 8 })];
		renderAt("/dashboard/jobs/job_1");
		const input = await screen.findByLabelText("Choose PDFs");
		// Someone else used the last slots since this page loaded, so only the server knows.
		jobs[0].cvCount = 10;
		fireEvent.change(input, { target: { files: [pdf("first.pdf"), pdf("second.pdf")] } });

		expect(await screen.findByText("2 not uploaded")).toBeTruthy();
		expect(screen.getAllByText("✕ This job has used its 10 free CVs")).toHaveLength(2);
		expect(uploads()).toHaveLength(1);
		// The page catches up with the server: the count is right and the chooser is gone.
		expect(await screen.findByText("10 of 10 free CVs used")).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(screen.getByText("This job has used its 10 free CVs.")).toBeTruthy();
	});

	it("learns that a job was closed when the API refuses a CV, and keeps the result on screen", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = await screen.findByLabelText("Choose PDFs");
		jobs[0].status = "closed";
		fireEvent.change(input, { target: { files: [pdf("late.pdf"), pdf("later.pdf")] } });

		expect(await screen.findByText("2 not uploaded")).toBeTruthy();
		expect(screen.getAllByText("✕ This job isn't open, so it can't take CVs. Open it first.")).toHaveLength(2);
		expect(uploads()).toHaveLength(1);
		// The job is read again, so the page now shows it closed instead of offering the zone.
		expect(await screen.findByText(/This job is closed, so it can't take new CVs/)).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(screen.getByText("late.pdf")).toBeTruthy();
	});

	it("keeps the file input usable while uploading, and ignores files chosen meanwhile", async () => {
		renderAt("/dashboard/jobs/job_1");
		const input = (await screen.findByLabelText("Choose PDFs")) as HTMLInputElement;
		const uploading = hold(isUpload);
		fireEvent.change(input, { target: { files: [pdf("one.pdf")] } });

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
		fireEvent.change(screen.getByLabelText("Choose PDFs"), { target: { files: [pdf("fresh.pdf"), pdf("next.pdf")] } });
		await waitFor(() => expect(uploading.pending()).toBe(1));
		await act(async () => uploading.release());
		await waitFor(() => expect(uploading.pending()).toBe(1));

		// First file is in. The old answer now lands, and must not wipe it from the list.
		await act(async () => lists.release());
		await act(() => vi.advanceTimersByTimeAsync(100));
		expect(within(screen.getByRole("list", { name: "Candidates" })).getByText("fresh.pdf")).toBeTruthy();
		await act(async () => uploading.release());
	});

	it("shows a note instead of the upload zone on a job that is not open", async () => {
		jobs = [openJob({ id: "job_1", status: "draft" }), openJob({ id: "job_2", status: "closed" })];

		renderAt("/dashboard/jobs/job_1");
		expect(await screen.findByText(/This job is a draft, so it can't take CVs yet/)).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();
		expect(screen.queryByText("Drop CVs here")).toBeNull();
		cleanup();

		renderAt("/dashboard/jobs/job_2");
		expect(await screen.findByText(/This job is closed, so it can't take new CVs/)).toBeTruthy();
		expect(screen.queryByLabelText("Choose PDFs")).toBeNull();

		// Opening the draft brings the zone in.
		cleanup();
		renderAt("/dashboard/jobs/job_1");
		fireEvent.click(await screen.findByRole("button", { name: /Open job/ }));
		expect(await screen.findByLabelText("Choose PDFs")).toBeTruthy();
		expect(screen.queryByText(/This job is a draft/)).toBeNull();
		expect(screen.getByText("Job opened").getAttribute("aria-live")).toBe("polite");
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

		// Only the best match gets the marker stroke and the ring.
		const links = within(screen.getByRole("list", { name: "Candidates" })).getAllByRole("link");
		expect(links[0].className).toContain("rank-band");
		expect(links[1].className).not.toContain("rank-band");
		expect(links[0].querySelector(".score-ring")).toBeTruthy();
		expect(links[1].querySelector(".score-ring")).toBeNull();
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
		expect(screen.getByRole("status").textContent).toBe("Reading the CV");
		expect(screen.queryByRole("region", { name: "Must-haves" })).toBeNull();

		Object.assign(candidates[0], grace());
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));

		expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
		expect(document.title).toBe("Grace Turner · LucidHire");
		expect(screen.getByText("Scored 93 · 2 of 4 requirements")).toBeTruthy();
		expect(screen.getByRole("region", { name: "Must-haves" })).toBeTruthy();
	});

	it("opens a candidate with the evidence for each requirement, must-haves first", async () => {
		candidates = [grace()];
		renderAt("/dashboard/jobs/job_1");

		fireEvent.click(await screen.findByRole("link", { name: /Grace Turner/ }));
		expect(await screen.findByRole("heading", { level: 1, name: "Grace Turner" })).toBeTruthy();
		expect(document.title).toBe("Grace Turner · LucidHire");
		expect(screen.getByText("Senior iOS Engineer · London")).toBeTruthy();
		expect(screen.getByText("Six years of SwiftUI at a bank. No Kotlin shown.")).toBeTruthy();
		expect(screen.getByText("Scored 93 · 2 of 4 requirements")).toBeTruthy();
		expect(screen.getByText("Must-haves 1 of 2 · Nice to have 1 of 2")).toBeTruthy();
		expect(screen.getByText("CV file · grace_turner.pdf · 117 KB")).toBeTruthy();
		const back = screen.getByRole("link", { name: "Senior iOS Engineer" });
		expect(back.getAttribute("href")).toBe("/dashboard/jobs/job_1");

		const must = screen.getByRole("region", { name: "Must-haves" });
		const nice = screen.getByRole("region", { name: "Nice to have" });
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
		expect(await screen.findByText(/^Scored 93/)).toBeTruthy();
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
		fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
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
		renderAt("/dashboard");

		expect(await screen.findByText("Created 22 Oct 2026 · 3 CVs")).toBeTruthy();
		expect(screen.getByText("Created 22 Oct 2026 · 1 CV")).toBeTruthy();
		expect(screen.getAllByText("Created 22 Oct 2026")).toHaveLength(1);
	});

	describe("decisions", () => {
		const decisionGroup = async () => screen.findByRole("radiogroup", { name: "Decision" });
		const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
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
		};

		it("shows the decision as a radio group of three, undecided to begin with", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			const group = await decisionGroup();
			const options = within(group).getAllByRole("radio") as HTMLInputElement[];
			expect(options.map((option) => option.labels?.[0].textContent)).toEqual(["Undecided", "Shortlisted", "Rejected"]);
			expect(options.map((option) => option.checked)).toEqual([true, false, false]);
			// One name makes them one group, which is what gives them the arrow keys and a single tab stop.
			expect(new Set(options.map((option) => option.name)).size).toBe(1);
			expect(options.every((option) => option.type === "radio")).toBe(true);
			expect(screen.getByRole("heading", { level: 2, name: "Decision" })).toBeTruthy();

			// Right after the summary and before the requirements.
			const summaryText = screen.getByText("Six years of SwiftUI at a bank. No Kotlin shown.");
			const requirements = screen.getByRole("heading", { level: 2, name: "Requirements" });
			expect(summaryText.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			expect(group.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		});

		it("shortlists, rejects and un-decides at once, sends only the decision and announces each change", async () => {
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();
			const saving = hold(isPatch);

			fireEvent.click(radio("Shortlisted"));
			const announced = screen.getByText("Marked as shortlisted");
			expect(announced.getAttribute("aria-live")).toBe("polite");
			expect(announced.className).toContain("sr-only");
			// The page shows it before the API has answered.
			await waitFor(() => expect(saving.pending()).toBe(1));
			expect(radio("Shortlisted").checked).toBe(true);
			expect(radio("Undecided").checked).toBe(false);
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
			expect(radio("Shortlisted").checked).toBe(true);

			fireEvent.click(radio("Rejected"));
			expect(screen.getByText("Marked as rejected")).toBeTruthy();
			await waitFor(() => expect(patches()).toHaveLength(2));
			expect(radio("Rejected").checked).toBe(true);
			expect(patches()[1][1]?.body).toBe(JSON.stringify({ decision: "rejected" }));
			await act(async () => saving.release());

			fireEvent.click(radio("Undecided"));
			expect(screen.getByText("Marked as undecided")).toBeTruthy();
			await waitFor(() => expect(patches()).toHaveLength(3));
			expect(radio("Undecided").checked).toBe(true);
			await act(async () => saving.release());
			await waitFor(() => expect(candidates[0]).toMatchObject({ decision: "undecided", decidedAt: null }));
			expect(screen.queryByRole("alert")).toBeNull();
		});

		it("lets a member decide too", async () => {
			org = { id: "org_1", name: "Sprite Labs", role: "member" };
			candidates = [grace()];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();

			fireEvent.click(radio("Rejected"));
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
			expect(radio("Rejected").checked).toBe(true);
		});

		it("puts the old decision back and says why when the API refuses", async () => {
			candidates = [grace({ decision: "shortlisted" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			await decisionGroup();
			expect(radio("Shortlisted").checked).toBe(true);
			refuseChanges();
			const refusing = hold(isPatch);

			fireEvent.click(radio("Rejected"));
			await waitFor(() => expect(refusing.pending()).toBe(1));
			expect(radio("Rejected").checked).toBe(true);
			await act(async () => refusing.release());

			expect((await screen.findByRole("alert")).textContent).toBe("✕ Something went wrong. Try again.");
			expect(radio("Shortlisted").checked).toBe(true);
			expect(radio("Rejected").checked).toBe(false);
			// Nothing is announced for a change that didn't happen.
			expect(screen.queryByText("Marked as rejected")).toBeNull();
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

		it("pre-fills the note, saves it, and says Saved", async () => {
			candidates = [grace({ note: "Strong on SwiftUI." })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");

			const note = (await screen.findByLabelText("Note")) as HTMLTextAreaElement;
			expect(note.value).toBe("Strong on SwiftUI.");
			expect(note.maxLength).toBe(1000);
			expect(screen.getByText("18 / 1,000")).toBeTruthy();
			expect(screen.getByText("Everyone at Sprite Labs can read this.")).toBeTruthy();
			const save = screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement;
			// Nothing to save yet.
			expect(save.disabled).toBe(true);

			fireEvent.change(note, { target: { value: "Strong on SwiftUI. Call on Monday." } });
			expect(save.disabled).toBe(false);
			expect(screen.getByText("34 / 1,000")).toBeTruthy();
			expect(screen.queryByText("Saved")).toBeNull();
			fireEvent.click(save);

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
			expect(save.disabled).toBe(true);
			expect(screen.getByText("Saved").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");

			// Typing again clears the confirmation, and an empty note clears the saved one.
			fireEvent.change(note, { target: { value: "   " } });
			expect(screen.queryByText("Saved")).toBeNull();
			fireEvent.click(save);
			await waitFor(() => expect(candidates[0].note).toBeNull());
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(note.value).toBe("");
		});

		it("keeps Save note focusable while it saves, and sends the note once", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			fireEvent.change(await screen.findByLabelText("Note"), { target: { value: "New note" } });
			const save = screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement;
			const saving = hold(isPatch);
			save.focus();

			fireEvent.click(save);
			await waitFor(() => expect(saving.pending()).toBe(1));
			// It looks busy but is not disabled, so keyboard focus stays; a second click sends nothing.
			expect(save.textContent).toBe("Saving");
			expect(save.getAttribute("aria-disabled")).toBe("true");
			expect(save.disabled).toBe(false);
			expect(document.activeElement).toBe(save);
			fireEvent.click(save);
			expect(saving.pending()).toBe(1);

			await act(async () => saving.release());
			expect(await screen.findByText("Saved")).toBeTruthy();
			expect(patches()).toHaveLength(1);
			expect(save.getAttribute("aria-disabled")).toBe("false");
		});

		it("keeps what was typed and says why when a note can't be saved", async () => {
			candidates = [grace({ note: "Old note" })];
			renderAt("/dashboard/jobs/job_1/candidates/cand_grace");
			const note = (await screen.findByLabelText("Note")) as HTMLTextAreaElement;
			refuseChanges();

			fireEvent.change(note, { target: { value: "A better note" } });
			fireEvent.click(screen.getByRole("button", { name: "Save note" }));

			expect((await screen.findByRole("alert")).textContent).toBe("✕ Something went wrong. Try again.");
			expect(note.value).toBe("A better note");
			expect(screen.queryByText("Saved")).toBeNull();
			expect((screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement).disabled).toBe(false);
			expect(candidates[0].note).toBe("Old note");
		});

		it("can decide on a CV that failed", async () => {
			candidates = [
				fakeCandidate({ id: "cand_bad", fileName: "scan.pdf", status: "failed", error: "Scoring failed." }),
			];
			renderAt("/dashboard/jobs/job_1/candidates/cand_bad");
			await decisionGroup();

			fireEvent.click(radio("Rejected"));
			await waitFor(() => expect(candidates[0].decision).toBe("rejected"));
		});

		it("shows a decision made on the candidate page in the list", async () => {
			candidates = [grace(), fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 })];
			renderAt("/dashboard/jobs/job_1");

			fireEvent.click(await screen.findByRole("link", { name: /Grace Turner/ }));
			await decisionGroup();
			fireEvent.click(radio("Shortlisted"));
			await waitFor(() => expect(candidates[0].decision).toBe("shortlisted"));
			fireEvent.click(screen.getByRole("link", { name: "Senior iOS Engineer" }));

			const list = await screen.findByRole("list", { name: "Candidates" });
			expect(within(list).getByText("Shortlisted")).toBeTruthy();
			expect(screen.getByRole("radio", { name: "Shortlisted 1" })).toBeTruthy();
		});
	});

	describe("the ranked list", () => {
		const ana = () => fakeCandidate({ id: "cand_ana", name: "Ana Silva", score: 65, decision: "rejected" });
		const kenji = () => fakeCandidate({ id: "cand_kenji", name: "Kenji Tanaka", score: 71 });
		const filter = () => screen.getByRole("radiogroup", { name: "Show" });
		const show = (name: string) => fireEvent.click(within(filter()).getByRole("radio", { name }));

		it("marks shortlisted and rejected CVs in words, mutes the rejected and leaves the others alone", async () => {
			candidates = [grace({ decision: "shortlisted" }), kenji(), ana()];
			renderAt("/dashboard/jobs/job_1");

			const list = await screen.findByRole("list", { name: "Candidates" });
			const shortlisted = within(list).getByText("Shortlisted");
			expect(shortlisted.className).toContain("bg-marker");
			const rejected = within(list).getByText("Rejected");
			expect(rejected.className).toContain("bg-gap");
			// Nothing on the undecided row.
			const rows = within(list).getAllByRole("listitem");
			expect(rows[1].textContent).toMatch(/Kenji Tanaka/);
			expect(rows[1].textContent).not.toMatch(/Shortlisted|Rejected|Undecided/);
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
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			const options = within(filter()).getAllByRole("radio") as HTMLInputElement[];
			expect(options.map((option) => option.labels?.[0].textContent)).toEqual([
				"All 5",
				"Shortlisted 1",
				"Undecided 3",
				"Rejected 1",
			]);
			expect(options.map((option) => option.checked)).toEqual([true, false, false, false]);
			expect(rowTexts()).toHaveLength(5);

			show("Rejected 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 3: Ana Silva/)]);
			show("Undecided 3");
			expect(rowTexts()).toEqual([
				expect.stringMatching(/Rank 2: Kenji Tanaka/),
				expect.stringMatching(/new_upload\.pdf/),
				expect.stringMatching(/scan\.pdf/),
			]);
			show("Shortlisted 1");
			expect(rowTexts()).toEqual([expect.stringMatching(/Rank 1: Grace Turner/)]);
			show("All 5");
			expect(rowTexts()).toHaveLength(5);
			// The filter only hides rows. The header still counts the whole list, and nothing was asked of the API.
			expect(screen.getByText("3 of 5 read · 1 failed")).toBeTruthy();
			expect(patches()).toHaveLength(0);
		});

		it("says when nothing has that decision", async () => {
			candidates = [grace(), kenji()];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");

			show("Shortlisted 0");
			expect(screen.getByText("No shortlisted candidates yet.")).toBeTruthy();
			expect(screen.queryByRole("list", { name: "Candidates" })).toBeNull();
			show("Rejected 0");
			expect(screen.getByText("No rejected candidates yet.")).toBeTruthy();
			show("Undecided 2");
			expect(screen.queryByText(/No .* candidates yet\./)).toBeNull();
			expect(rowTexts()).toHaveLength(2);

			candidates = [];
			cleanup();
			candidates = [grace({ decision: "rejected" })];
			renderAt("/dashboard/jobs/job_1");
			await screen.findByText("Grace Turner");
			show("Undecided 0");
			expect(screen.getByText("No undecided candidates yet.")).toBeTruthy();
		});

		it("shows the filter only once a CV is scored", async () => {
			candidates = [fakeCandidate({ id: "cand_new", fileName: "new_upload.pdf", status: "queued" })];
			renderAt("/dashboard/jobs/job_1");

			await screen.findByText("new_upload.pdf");
			expect(screen.queryByRole("radiogroup", { name: "Show" })).toBeNull();
		});

		const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
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
			// It sits on the line that names the file.
			expect(screen.getByText("CV file · grace_turner.pdf · 117 KB").parentElement?.contains(button)).toBe(true);

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
	});
});
