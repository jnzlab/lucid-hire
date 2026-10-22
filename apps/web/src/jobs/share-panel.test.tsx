import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../lib/jobs.ts";
import { PublicLink } from "./share-panel.tsx";

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

describe("PublicLink", () => {
	it("shows the link, copies it and says so", async () => {
		render(<PublicLink job={job} />);
		expect(screen.getByText(url)).toBeTruthy();
		const open = screen.getByRole("link", { name: "Open public page" });
		expect(open.getAttribute("href")).toBe(url);
		expect(open.getAttribute("target")).toBe("_blank");

		fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
		expect((await screen.findByRole("status")).textContent).toBe("Link copied");
	});

	it("shares by email, X, LinkedIn, WhatsApp and Facebook, or copies a caption", async () => {
		render(<PublicLink job={job} />);
		const toggle = screen.getByRole("button", { name: "Share" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href")!;
		expect(hrefOf("Email")).toMatch(/^mailto:\?subject=iOS%20Developer&body=/);
		expect(hrefOf("X")).toMatch(/^https:\/\/x\.com\/intent\/tweet\?text=/);
		expect(hrefOf("LinkedIn")).toContain("linkedin.com/sharing/share-offsite/?url=");
		expect(hrefOf("WhatsApp")).toContain("api.whatsapp.com/send?text=");
		expect(hrefOf("Facebook")).toContain("facebook.com/sharer/sharer.php?u=");
		expect(screen.getByRole("link", { name: "X" }).getAttribute("target")).toBe("_blank");

		fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(`iOS Developer\n\nAbout Build great apps.\n\nApply here: ${url}`));
		expect((await screen.findByRole("status")).textContent).toBe("Caption copied");
		expect(screen.queryByRole("link", { name: "Facebook" })).toBeNull();
	});

	it("closes the share menu with Escape", () => {
		render(<PublicLink job={job} />);
		fireEvent.click(screen.getByRole("button", { name: "Share" }));
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("link", { name: "Email" })).toBeNull();
	});

	it("offers no link for a draft", () => {
		render(<PublicLink job={{ ...job, status: "draft" }} />);
		expect(screen.getByText("Open the job to get a public link.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
	});

	it("keeps the link for a closed job but hides sharing", () => {
		render(<PublicLink job={{ ...job, status: "closed" }} />);
		expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open public page" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
	});

	it("says when the clipboard is unavailable", async () => {
		writeText.mockRejectedValue(new Error("denied"));
		render(<PublicLink job={job} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
		expect((await screen.findByRole("status")).textContent).toMatch(/Couldn't copy/);
	});
});
