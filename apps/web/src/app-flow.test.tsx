import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANDIDATE_POLL_MS, CV_MAX_BYTES, type Candidate } from "./lib/candidates.ts";
import { routeTree } from "./routeTree.gen.ts";

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
	RedirectToSignIn: () => <p>Redirecting to sign in</p>,
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
const withCount = (job: FakeJob) => ({ ...job, cvCount: job.cvCount ?? 0 });

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
	...rest
}: FakeCandidate) => rest;
const forPage = ({ jobId: _jobId, ...rest }: FakeCandidate): Candidate => rest;
// Scored first (best first), then the ones being read, then the failed, as the API orders them.
const place = (candidate: FakeCandidate) => ({ scored: 0, queued: 1, scoring: 1, failed: 2 })[candidate.status];

// The candidates API: the ranked list, upload (the raw PDF as the body), read, retry and admin-only delete.
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
		...fields,
	};
}

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

describe("jobs", () => {
	beforeEach(() => {
		org = { id: "org_1", name: "Sprite Labs", role: "admin" };
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
		expect(screen.getByText("Swift, SwiftUI, 5 years.")).toBeTruthy();
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
		// Hold the list's refetch, so the list can only show what the cache holds after the delete.
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			new URL(url).pathname === "/jobs" && init?.method === "GET" ? new Promise(() => {}) : answer(url, init),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete job" }));

		expect(await screen.findByText("Deleted “Sprite test role”")).toBeTruthy();
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
		expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
		// The refetch after the retry is held, so the order can only come from the page itself.
		hold(isListGet);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByText("Reading the CV")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
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
		fireEvent.click((await screen.findAllByRole("button", { name: "Retry" }))[0]);
		await waitFor(() => expect(retrying.pending()).toBe(1));

		const buttons = screen.getAllByRole("button", { name: /Retry/ });
		expect(buttons.map((button) => [button.textContent, (button as HTMLButtonElement).disabled])).toEqual([
			["Retrying", true],
			["Retry", false],
		]);
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
		expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
		const stuck = screen.getByRole("link", { name: /cand_stuck\.pdf/ }).closest("li")!;
		expect(within(stuck).getByText("This is taking longer than usual.")).toBeTruthy();
		expect(within(stuck).getByRole("button", { name: "Retry" })).toBeTruthy();

		// Retrying starts the clock again, which only the API's updatedAt can say.
		fireEvent.click(within(stuck).getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
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

		expect(await screen.findByText(/Couldn't refresh\. Retrying\./)).toBeTruthy();
		expect(screen.queryByText(/We couldn't load the candidates/)).toBeNull();
		expect(rowTexts()).toHaveLength(2);
		expect(screen.getByText("Grace Turner")).toBeTruthy();

		fetchMock.mockImplementation(answer);
		await act(() => vi.advanceTimersByTimeAsync(CANDIDATE_POLL_MS));
		await waitFor(() => expect(screen.queryByText(/Couldn't refresh/)).toBeNull());
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
		expect(await screen.findByText(/Couldn't refresh\. Retrying\./)).toBeTruthy();
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

		expect(await screen.findByText("Deleted “Grace Turner”")).toBeTruthy();
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
		fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete candidate" }));
		await waitFor(() => expect(deleting.pending()).toBe(1));
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
});
