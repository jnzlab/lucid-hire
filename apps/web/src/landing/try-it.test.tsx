import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TryIt } from "./try-it.tsx";

// jsdom has no matchMedia. Reduced motion shows each new score at once instead of counting to it.
beforeEach(() => {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: true,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const leader = () => screen.getByText(/leads with/).textContent;
const firstRow = () => within(screen.getAllByRole("listitem")[0]).getByText(/^[A-Z][a-z]+ [A-Z]/).textContent;

it("ranks the sample list as posted, then re-ranks it when the weights change", () => {
	render(<TryIt />);
	expect(leader()).toBe("Grace Turner leads with 93.");
	expect(firstRow()).toBe("Grace Turner");

	fireEvent.click(screen.getByRole("button", { name: "Android-leaning" }));
	expect(leader()).toBe("Rayan Al-Farsi leads with 95. Grace is 2nd.");
	expect(screen.getByRole("button", { name: "Android-leaning" }).getAttribute("aria-pressed")).toBe("true");
});

it("turns every requirement off and asks for one to rank by", () => {
	render(<TryIt />);
	for (const group of screen.getAllByRole("radiogroup")) fireEvent.click(within(group).getByLabelText("Off"));
	expect(screen.getByText("Turn on at least one requirement to rank the list.")).toBeTruthy();
});
