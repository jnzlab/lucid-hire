import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncedBanner } from "./announced-banner.tsx";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("AnnouncedBanner", () => {
	it("puts the polite live region on the page first and the message into it just after", () => {
		vi.useFakeTimers();
		const { container } = render(<AnnouncedBanner message="Deleted “Sprite test role”" />);

		const region = container.querySelector('[aria-live="polite"]');
		expect(region).toBeTruthy();
		expect(region?.textContent).toBe("");

		act(() => vi.advanceTimersByTime(100));
		// The same region, now filled: that is a change a screen reader announces.
		expect(container.querySelector('[aria-live="polite"]')).toBe(region);
		expect(region?.textContent).toBe("Deleted “Sprite test role”");
	});

	it("shows nothing when there is no message", () => {
		vi.useFakeTimers();
		const { container } = render(<AnnouncedBanner message={undefined} />);
		act(() => vi.advanceTimersByTime(1000));

		expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
	});
});
