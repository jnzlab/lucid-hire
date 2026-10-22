import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null, getToken: async () => null }),
	RedirectToSignIn: () => null,
	UserButton: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

type FakeJob = {
	slug: string;
	title: string;
	description: string;
	status: "open" | "closed";
	company: string;
	createdAt: string;
	hasCover: boolean;
};
const job: FakeJob = {
	slug: "ios-dev-abcd1234",
	title: "iOS Developer",
	description: "## What you'll do\n\nBuild **great** apps. See [our site](https://example.com).\n\n- Swift\n- SwiftUI\n\n<script>alert(1)</script>",
	status: "open",
	company: "Sprite Labs",
	createdAt: "2026-10-20T10:00:00Z",
	hasCover: false,
};

let current: FakeJob | null;
let applyResponse: () => Response;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let turnstileCallback: ((token: string) => void) | undefined;
let render_: Mock;
let reset: Mock;

// The Markdown renderer is loaded on demand; loading it once up front keeps the first test from racing the import.
beforeAll(() => import("../components/markdown.tsx"), 60_000);

beforeEach(() => {
	current = { ...job };
	applyResponse = () => Response.json({ ok: true }, { status: 201 });
	fetchMock = vi.fn(async (url: string) => {
		const path = new URL(url).pathname;
		if (path === `/public/jobs/${job.slug}`) {
			return current ? Response.json({ job: current }) : Response.json({ error: { code: "not_found", message: "This job isn't available" } }, { status: 404 });
		}
		if (path === `/public/jobs/${job.slug}/apply`) return applyResponse();
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("scrollTo", () => {});
	render_ = vi.fn((_el: HTMLElement, options: { callback: (token: string) => void }) => {
		turnstileCallback = options.callback;
		return "widget-1";
	});
	reset = vi.fn();
	vi.stubGlobal("turnstile", { render: render_, reset, remove: vi.fn() });
	(window as unknown as { turnstile: unknown }).turnstile = { render: render_, reset, remove: vi.fn() };
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	delete (window as { turnstile?: unknown }).turnstile;
});

function renderAt(path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

const applyCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith("/apply"));
const pdf = (name = "ada.pdf", size = 2048) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

async function openPage() {
	renderAt(`/jobs/${job.slug}`);
	// The first render also loads the code-split page, which can be slow on a busy machine.
	await screen.findByRole("heading", { level: 1, name: "iOS Developer" }, { timeout: 10_000 });
}

function fill(email: string, file: File | null) {
	fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
	if (file) fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

describe("public job page", () => {
	it("shows the job: tag, company, title and the Markdown description", async () => {
		await openPage();
		expect(document.title).toBe("iOS Developer | LucidHire");
		expect(screen.getByText("Open role")).toBeTruthy();
		expect(screen.getByText("Sprite Labs")).toBeTruthy();
		expect(await screen.findByRole("heading", { level: 2, name: "What you'll do" })).toBeTruthy();
		expect(await screen.findByText("Swift")).toBeTruthy();
		const link = screen.getByRole("link", { name: "our site" });
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		expect(document.querySelector("script")).toBeNull();
		expect(screen.getByRole("link", { name: /Back to LucidHire/ })).toBeTruthy();
	});

	it("says a draft or unknown job isn't available", async () => {
		current = null;
		renderAt(`/jobs/${job.slug}`);
		expect(await screen.findByRole("heading", { name: /This job isn't available/ })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go to LucidHire" })).toBeTruthy();
	});

	it("keeps a closed job readable and says applications are closed", async () => {
		current = { ...job, status: "closed" };
		await openPage();
		expect(screen.getByText("Closed role")).toBeTruthy();
		expect(await screen.findByRole("heading", { name: "Applications closed" })).toBeTruthy();
		expect(screen.queryByLabelText("Email address")).toBeNull();
		expect(await screen.findByText("Swift")).toBeTruthy();
	});

	it("keeps Submit application disabled until there is an email, a PDF and a passed check", async () => {
		await openPage();
		const submit = screen.getByRole("button", { name: "Submit application" }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		expect(screen.getByText(/Your CV is read by AI to help the hiring team/)).toBeTruthy();
		expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");

		fill("ada@example.com", pdf());
		expect(submit.disabled).toBe(true);
		expect(screen.getByText(/ada\.pdf · 2 KB/)).toBeTruthy();
		await waitFor(() => expect(turnstileCallback).toBeDefined());
		act(() => turnstileCallback!("token-1"));
		expect(submit.disabled).toBe(false);

		fill("not-an-email", null);
		expect(submit.disabled).toBe(true);
		expect(screen.getByText("✕ Enter a valid email address")).toBeTruthy();
	});

	it("refuses other file types and big files with a clear message", async () => {
		await openPage();
		fill("ada@example.com", new File(["x"], "cv.docx", { type: "application/msword" }));
		expect(screen.getByRole("alert").textContent).toContain("Upload your CV as a PDF file");
		fill("ada@example.com", pdf("big.pdf", 5 * 1024 * 1024 + 1));
		expect(screen.getByRole("alert").textContent).toContain("Your CV must be 5 MB or smaller");
		expect(screen.queryByText(/big\.pdf/)).toBeNull();
	});

	it("sends the PDF as the raw body with the email and token in headers, then thanks the applicant", async () => {
		await openPage();
		const file = pdf("Ada CV.pdf");
		fill(" Ada@Example.com ", file);
		await waitFor(() => expect(turnstileCallback).toBeDefined());
		act(() => turnstileCallback!("token-9"));
		fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

		expect(await screen.findByRole("heading", { name: "Your CV has been received" })).toBeTruthy();
		expect(screen.getByText("We'll be in touch if your profile is a match.")).toBeTruthy();
		const [[url, init]] = applyCalls();
		expect(url).toContain(`/public/jobs/${job.slug}/apply`);
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe(file);
		expect(init?.headers).toEqual({
			"Content-Type": "application/pdf",
			"X-Applicant-Email": "Ada@Example.com",
			"X-Turnstile-Token": "token-9",
			"X-File-Name": "Ada%20CV.pdf",
		});
	});

	it("shows the server's reason and restarts the security check after a refusal", async () => {
		applyResponse = () =>
			Response.json(
				{ error: { code: "already_applied", message: "You have already applied to this job using this email address." } },
				{ status: 409 },
			);
		await openPage();
		fill("ada@example.com", pdf());
		await waitFor(() => expect(turnstileCallback).toBeDefined());
		act(() => turnstileCallback!("token-1"));
		fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

		expect(await screen.findByText(/You have already applied to this job using this email address\./)).toBeTruthy();
		await waitFor(() => expect(reset).toHaveBeenCalled());
		expect((screen.getByRole("button", { name: "Submit application" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("offers the support address when the security check never loads", async () => {
		delete (window as { turnstile?: unknown }).turnstile;
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await openPage();
		expect(screen.getByText("Loading the security check")).toBeTruthy();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_500);
		});
		const alert = await screen.findByText(/The security check didn't load/);
		expect(alert.textContent).toContain("support@lucidhire.io");
		expect((screen.getByRole("button", { name: "Submit application" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
