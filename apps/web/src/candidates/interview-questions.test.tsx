import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateStatus } from "../lib/candidates.ts";
import type { QuestionSet } from "../lib/interview-questions.ts";
import { InterviewQuestions } from "./interview-questions.tsx";

// Clerk is replaced by a session we control; the API by a fetch mock for the one questions endpoint.
vi.mock("@clerk/react", () => ({
	useAuth: () => ({ userId: "user_1", getToken: async () => "session-token" }),
}));

const first = { question: "You used SwiftUI at Acme. Which screen was the hardest to build, and why?", focus: "SwiftUI" };
const second = { question: "The job needs Combine and your CV doesn't show it. What have you done that comes closest?", focus: "Combine" };
const written: QuestionSet = { questions: [first, second], generatedAt: "2026-10-22T14:00:00.000Z" };
const empty: QuestionSet = { questions: null, generatedAt: null };

const URL_ = "http://localhost:8787/jobs/job_1/candidates/cand_1/questions";

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let saved: QuestionSet;
// What the next POST answers with; a test can hold it back to look at the page while it waits.
let post: () => Promise<Response>;

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
	saved = empty;
	post = async () => Response.json(written);
	fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
		init?.method === "POST" ? post() : Response.json(saved),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(navigator, "clipboard");
});

function renderQuestions(status: CandidateStatus = "scored") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<InterviewQuestions jobId="job_1" candidate={{ id: "cand_1", status }} />
		</QueryClientProvider>,
	);
}

// Holds the next POST back until the returned function answers it.
function holdPost() {
	let answer: (response: Response) => void = () => {};
	const held = new Promise<Response>((resolve) => (answer = resolve));
	post = () => held;
	return answer;
}

const clipboard = (writeText: (text: string) => Promise<void>) =>
	Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

describe("interview questions", () => {
	it("starts with an invitation, writes the questions and lists them", async () => {
		renderQuestions();

		const heading = await screen.findByRole("heading", { level: 2, name: "Interview questions" });
		expect(heading.tagName).toBe("H2");
		expect(await screen.findByText("Questions that probe this candidate's gaps and check their strongest claims.")).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledWith(URL_, expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }));
		expect(screen.queryByRole("list")).toBeNull();
		expect(screen.queryByRole("button", { name: "Copy all" })).toBeNull();

		const answer = holdPost();
		fireEvent.click(screen.getByRole("button", { name: "Write questions" }));

		// While it writes the button stays in place and focusable, but a second click sends nothing.
		const writing = await screen.findByRole("button", { name: "Writing questions…" });
		expect(writing.getAttribute("aria-disabled")).toBe("true");
		expect(writing.hasAttribute("disabled")).toBe(false);
		const status = screen.getByText("Writing questions. This takes 10 to 30 seconds.");
		expect(status.getAttribute("role")).toBe("status");
		fireEvent.click(writing);
		expect(posts()).toHaveLength(1);
		expect(posts()[0]).toEqual([URL_, expect.objectContaining({ method: "POST" })]);

		answer(Response.json(written));
		const items = await screen.findAllByRole("listitem");
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByText(first.question)).toBeTruthy();
		expect(within(items[0]).getByText("SwiftUI")).toBeTruthy();
		expect(within(items[1]).getByText(second.question)).toBeTruthy();
		expect(within(items[1]).getByText("Combine")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copy all" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Write new questions" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Write questions" })).toBeNull();
		expect(screen.queryByText("Writing questions. This takes 10 to 30 seconds.")).toBeNull();
		// The button that was focused is gone, so focus moves to the list.
		expect(document.activeElement).toBe(screen.getByRole("list", { name: "Interview questions" }));
	});

	it("shows questions written earlier, and replaces them when new ones are written", async () => {
		saved = written;
		const next: QuestionSet = {
			questions: [{ question: "Walk me through the migration you led.", focus: "Migrations" }],
			generatedAt: "2026-10-22T15:00:00.000Z",
		};
		renderQuestions();

		expect(await screen.findByText(first.question)).toBeTruthy();
		expect(screen.queryByText("Questions that probe this candidate's gaps and check their strongest claims.")).toBeNull();

		const answer = holdPost();
		fireEvent.click(screen.getByRole("button", { name: "Write new questions" }));
		expect(await screen.findByRole("button", { name: "Writing questions…" })).toBeTruthy();
		// The old list stays up while the new one is written.
		expect(screen.getByText(first.question)).toBeTruthy();

		answer(Response.json(next));
		expect(await screen.findByText("Walk me through the migration you led.")).toBeTruthy();
		expect(screen.queryByText(first.question)).toBeNull();
		expect(screen.getAllByRole("listitem")).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Write new questions" })).toBeTruthy();
	});

	it("copies the questions as numbered plain text", async () => {
		saved = written;
		const writeText = vi.fn(async () => {});
		clipboard(writeText);
		renderQuestions();

		fireEvent.click(await screen.findByRole("button", { name: "Copy all" }));

		expect(await screen.findByText("Copied")).toBeTruthy();
		expect(screen.getByRole("status").textContent).toContain("Copied");
		expect(writeText).toHaveBeenCalledWith(`1. ${first.question}\n2. ${second.question}`);
	});

	it("says so when the clipboard can't be used", async () => {
		saved = written;
		clipboard(async () => {
			throw new Error("denied");
		});
		renderQuestions();

		fireEvent.click(await screen.findByRole("button", { name: "Copy all" }));

		expect((await screen.findByRole("alert")).textContent).toBe("✕ We couldn't copy the questions. Select them and copy by hand.");
		expect(screen.queryByText("Copied")).toBeNull();
	});

	it("shows the server's message when writing fails, and lets the recruiter try again", async () => {
		post = async () =>
			Response.json(
				{ error: { code: "ai_failed", message: "We couldn't write questions right now. Try again." } },
				{ status: 502 },
			);
		renderQuestions();

		fireEvent.click(await screen.findByRole("button", { name: "Write questions" }));

		expect((await screen.findByRole("alert")).textContent).toBe("✕ We couldn't write questions right now. Try again.");
		const button = screen.getByRole("button", { name: "Write questions" });
		expect(button.getAttribute("aria-disabled")).toBe("false");
		expect(screen.queryByRole("list")).toBeNull();

		post = async () => Response.json(written);
		fireEvent.click(button);
		expect(await screen.findAllByRole("listitem")).toHaveLength(2);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(posts()).toHaveLength(2);
	});

	it("shows the server's message when the saved questions can't be loaded", async () => {
		fetchMock.mockImplementationOnce(async () =>
			Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }),
		);
		fetchMock.mockImplementationOnce(async () =>
			Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }),
		);
		renderQuestions();

		expect((await screen.findByRole("alert", {}, { timeout: 3000 })).textContent).toBe("✕ Something went wrong");
		expect(screen.queryByRole("button", { name: "Write questions" })).toBeNull();

		saved = written;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText(first.question)).toBeTruthy();
	});

	it.each(["queued", "scoring", "failed"] as const)("is not shown, or asked for, while the CV is %s", (status) => {
		const { container } = renderQuestions(status);

		expect(container.innerHTML).toBe("");
		expect(screen.queryByText("Interview questions")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
