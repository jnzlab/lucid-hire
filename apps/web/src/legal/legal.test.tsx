import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null, getToken: async () => null }),
	Show: () => null,
}));

afterEach(cleanup);

async function renderAt(path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(<RouterProvider router={router} />);
	return router;
}

describe("legal pages", () => {
	it("shows the privacy policy with its date, contents and processors", async () => {
		await renderAt("/privacy");

		expect(await screen.findByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
		expect(screen.getByText("Last updated 22 October 2026")).toBeTruthy();
		expect(document.title).toBe("Privacy policy · LucidHire");

		const contents = screen.getByRole("navigation", { name: "On this page" });
		expect(within(contents).getByRole("link", { name: /How the AI ranking works/ }).getAttribute("href")).toBe("#ai");
		for (const processor of ["Cloudflare", "Clerk", "Google (Gemini API)", "Polar"]) {
			expect(screen.getByText(processor)).toBeTruthy();
		}
		expect(screen.getAllByRole("link", { name: "privacy@lucidhire.io" })[0]?.getAttribute("href")).toBe(
			"mailto:privacy@lucidhire.io",
		);
		expect(document.getElementById("rights")).toBeTruthy();
	});

	it("shows the terms with the plans and limits", async () => {
		await renderAt("/terms");

		expect(await screen.findByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
		expect(document.title).toBe("Terms of service · LucidHire");
		expect(screen.getByText(/10 CVs per job, 10 new jobs a UTC month, 30 AI requests an hour/)).toBeTruthy();
		expect(screen.getByText(/1,000 CVs per job, unlimited new jobs, 600 AI requests an hour/)).toBeTruthy();
		expect(screen.getAllByRole("link", { name: "support@lucidhire.io" })[0]?.getAttribute("href")).toBe(
			"mailto:support@lucidhire.io",
		);
	});

	it("links the other legal page and support from the footer", async () => {
		await renderAt("/terms");
		const footer = await screen.findByRole("navigation", { name: "Footer" });

		expect(within(footer).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
		expect(within(footer).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
		expect(within(footer).getByRole("link", { name: "Support" }).getAttribute("href")).toBe("mailto:support@lucidhire.io");
	});
});
