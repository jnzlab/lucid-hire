import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../lib/jobs.ts";
import { ShareButton, SharePanel } from "./share-panel.tsx";

configure({ asyncUtilTimeout: 5000 });

const job: Job = {
	id: "job_1",
	slug: "ios-dev-abcd1234",
	title: "iOS Developer",
	description: "## About\n\nBuild **great** apps.",
	status: "open",
	cvCount: 0,
	hasCover: false,
	createdAt: "2026-10-20T10:00:00Z",
	updatedAt: "2026-10-20T10:00:00Z",
	rubric: null,
	rubricStatus: "none",
};
const url = "https://lucidhire.io/jobs/ios-dev-abcd1234";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	writeText = vi.fn(async () => {});
	vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("SharePanel", () => {
	it("shows the link, copies it and says so", async () => {
		render(<SharePanel job={job} />);
		expect(screen.getByText(url)).toBeTruthy();
		const open = screen.getByRole("link", { name: "Open public page" });
		expect(open.getAttribute("href")).toBe(url);
		expect(open.getAttribute("target")).toBe("_blank");

		fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
		expect((await screen.findByRole("status")).textContent).toBe("Link copied");
	});

	it("shares by email, X, LinkedIn, WhatsApp and Facebook, or copies a caption", async () => {
		render(<SharePanel job={job} />);
		const targets = within(screen.getByRole("group", { name: "Share to" }));
		const hrefOf = (name: string) => targets.getByRole("link", { name }).getAttribute("href")!;
		expect(hrefOf("Email")).toMatch(/^mailto:\?subject=iOS%20Developer&body=/);
		expect(hrefOf("X")).toMatch(/^https:\/\/x\.com\/intent\/tweet\?text=/);
		expect(hrefOf("LinkedIn")).toContain("linkedin.com/sharing/share-offsite/?url=");
		expect(hrefOf("WhatsApp")).toContain("api.whatsapp.com/send?text=");
		expect(hrefOf("Facebook")).toContain("facebook.com/sharer/sharer.php?u=");
		expect(targets.getByRole("link", { name: "X" }).getAttribute("target")).toBe("_blank");

		fireEvent.click(targets.getByRole("button", { name: "Copy caption" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(`iOS Developer\n\nAbout Build great apps.\n\nApply here: ${url}`));
		expect((await screen.findByRole("status")).textContent).toBe("Caption copied");
	});

	it("offers no link for a draft", () => {
		render(<SharePanel job={{ ...job, status: "draft" }} />);
		expect(screen.getByText("Open the job to get a public link.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
		expect(screen.queryByRole("group", { name: "Share to" })).toBeNull();
	});

	it("keeps the link for a closed job but says why it isn't worth sharing", () => {
		render(<SharePanel job={{ ...job, status: "closed" }} />);
		expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open public page" })).toBeTruthy();
		expect(screen.getByText("The job is closed, so its page says it isn't taking CVs.")).toBeTruthy();
		expect(screen.queryByRole("group", { name: "Share to" })).toBeNull();
	});

	it("says when the clipboard is unavailable", async () => {
		writeText.mockRejectedValue(new Error("denied"));
		render(<SharePanel job={job} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
		expect((await screen.findByRole("status")).textContent).toMatch(/Couldn't copy/);
	});
});

describe("ShareButton", () => {
	it("opens the panel in a popover and closes it with Escape, back on the button", async () => {
		render(<ShareButton job={job} />);
		const toggle = screen.getByRole("button", { name: "Share" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		const panel = screen.getByRole("dialog", { name: "Share this job" });
		expect(within(panel).getByText(url)).toBeTruthy();

		fireEvent.keyDown(within(panel).getByRole("button", { name: "Copy link" }), { key: "Escape" });
		expect(screen.queryByRole("dialog", { name: "Share this job" })).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(toggle));
	});
});
