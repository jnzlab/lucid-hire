import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "./routeTree.gen.ts";

// Clerk is replaced by a session we control; the API by an in-memory fake of /me, /orgs and /jobs.
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
type FakeJob = { id: string; title: string; description: string; status: string; createdAt: string; updatedAt: string };
let org: Org | null;
let jobs: FakeJob[];
let fetchMock: ReturnType<typeof vi.fn>;

const notFound = () => Response.json({ error: { message: "That job doesn't exist or isn't yours" } }, { status: 404 });

// The jobs API, enough of it for the pages: list, create, read, edit, delete and the AI rewrite.
function fakeJobs(path: string, method: string, body: Record<string, string>): Response {
	const id = path.split("/")[2];
	const job = jobs.find((candidate) => candidate.id === id);
	if (path === "/jobs" && method === "GET") {
		return Response.json({
			jobs: jobs.map(({ id, title, status, createdAt, updatedAt }) => ({ id, title, status, createdAt, updatedAt })),
		});
	}
	if (path === "/jobs" && method === "POST") {
		const now = new Date("2026-10-22T12:00:00Z").toISOString();
		const created = { id: `job_${jobs.length + 1}`, createdAt: now, updatedAt: now, status: "draft", ...body } as FakeJob;
		jobs.unshift(created);
		return Response.json({ job: created }, { status: 201 });
	}
	if (path === "/jobs/enhance") {
		return Response.json({ description: `What you need:\n- ${body.description}` });
	}
	if (!job) return notFound();
	if (method === "GET") return Response.json({ job });
	if (method === "PATCH") {
		Object.assign(job, body, { updatedAt: new Date("2026-10-23T09:00:00Z").toISOString() });
		return Response.json({ job });
	}
	if (method === "DELETE") {
		jobs = jobs.filter((candidate) => candidate !== job);
		return new Response(null, { status: 204 });
	}
	return notFound();
}

beforeEach(() => {
	session.signedIn = true;
	org = null;
	jobs = [];
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
		if (path === "/me") return Response.json({ userId: "user_1", org });
		if (path === "/orgs" && method === "POST") {
			org = { id: "org_1", name: body.name, role: "admin" };
			return Response.json({ org }, { status: 201 });
		}
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
		jobs = [
			{
				id: "job_9",
				title: "Sprite test role",
				description: "x",
				status: "open",
				createdAt: "2026-10-22T12:00:00Z",
				updatedAt: "2026-10-22T12:00:00Z",
			},
		];
		const router = renderAt("/dashboard/jobs/job_9");

		fireEvent.click(await screen.findByRole("button", { name: "Delete job" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Delete “Sprite test role”?" });
		expect(document.activeElement).toHaveProperty("textContent", "Cancel");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete job" }));

		expect(await screen.findByText("Deleted “Sprite test role”")).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard");
		expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeTruthy();
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
