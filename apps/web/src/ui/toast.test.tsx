import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./toast.tsx";
import { TOAST_ACTION_DURATION_MS, TOAST_DURATION_MS, type ToastApi, useToast } from "./use-toast.ts";

let api: ToastApi;
function Grab() {
	const toast = useToast();
	useEffect(() => {
		api = toast;
	});
	return null;
}

const region = () => screen.getByRole("region", { name: "Notifications" });
const shown = () => within(region()).queryAllByRole("listitem").map((item) => item.querySelector("p")?.textContent);

beforeEach(() => {
	vi.useFakeTimers();
	render(
		<ToastProvider>
			<Grab />
		</ToastProvider>,
	);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("toasts", () => {
	it("announce politely and go after five seconds", () => {
		expect(region().querySelector("ol")?.getAttribute("aria-live")).toBe("polite");
		act(() => void api.show("Job published"));
		expect(shown()).toEqual(["Job published"]);
		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
		expect(shown()).toEqual(["Job published"]);
		act(() => vi.advanceTimersByTime(1));
		expect(shown()).toEqual([]);
	});

	it("stay eight seconds when they offer Undo", () => {
		act(() => void api.show({ message: "Marked Ada as not a fit", action: { label: "Undo", onClick: () => {} } }));
		act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS - 1));
		expect(shown()).toEqual(["Marked Ada as not a fit"]);
		act(() => vi.advanceTimersByTime(1));
		expect(shown()).toEqual([]);
	});

	it("pause while the pointer is over them, and carry on for the time that was left", () => {
		act(() => void api.show("Copied the link"));
		act(() => vi.advanceTimersByTime(2000));
		fireEvent.pointerEnter(region());
		act(() => vi.advanceTimersByTime(20_000));
		expect(shown()).toEqual(["Copied the link"]);
		fireEvent.pointerLeave(region());
		act(() => vi.advanceTimersByTime(2999));
		expect(shown()).toEqual(["Copied the link"]);
		act(() => vi.advanceTimersByTime(1));
		expect(shown()).toEqual([]);
	});

	it("pause while focus is in them, and Escape dismisses the focused one", () => {
		act(() => {
			api.show({ message: "Shortlisted Grace Turner", action: { label: "Undo", onClick: () => {} } });
			api.show("Saved");
		});
		const undo = screen.getByRole("button", { name: "Undo" });
		act(() => undo.focus());
		act(() => vi.advanceTimersByTime(20_000));
		expect(shown()).toEqual(["Shortlisted Grace Turner", "Saved"]);

		fireEvent.keyDown(undo, { key: "Escape" });
		expect(shown()).toEqual(["Saved"]);
		// The focused toast is gone, so the clock runs again.
		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
		expect(shown()).toEqual([]);
	});

	it("send focus back to where it was when the focused toast closes", () => {
		const row = document.createElement("button");
		row.textContent = "Grace Turner";
		document.body.append(row);
		row.focus();
		act(() => void api.show({ message: "Shortlisted Grace Turner", action: { label: "Undo", onClick: () => {} } }));
		const undo = screen.getByRole("button", { name: "Undo" });
		act(() => undo.focus());
		fireEvent.click(undo);
		act(() => vi.advanceTimersByTime(20));
		expect(shown()).toEqual([]);
		expect(document.activeElement).toBe(row);
		row.remove();
	});

	it("keep at most three, dropping the oldest", () => {
		act(() => {
			for (const message of ["One", "Two", "Three", "Four"]) api.show(message);
		});
		expect(shown()).toEqual(["Two", "Three", "Four"]);
	});

	it("run their action once and close, and close from Dismiss", () => {
		const undo = vi.fn();
		act(() => void api.show({ message: "Moved to Not a fit", action: { label: "Undo", onClick: undo } }));
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledTimes(1);
		expect(shown()).toEqual([]);

		act(() => void api.show("Saved"));
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(shown()).toEqual([]);
	});

	it("start errors with ✕ and say Error to screen readers", () => {
		act(() => void api.error("Couldn't save the note."));
		const item = within(region()).getByRole("listitem");
		expect(item.textContent).toContain("✕ ");
		expect(within(item).getByText("Error:").className).toContain("sr-only");
	});

	it("stay until dismissed with an endless duration, and can be dismissed by id", () => {
		let id = "";
		act(() => {
			id = api.show({ message: "Reading 40 CVs", duration: Number.POSITIVE_INFINITY });
		});
		act(() => vi.advanceTimersByTime(60_000));
		expect(shown()).toEqual(["Reading 40 CVs"]);
		act(() => api.dismiss(id));
		expect(shown()).toEqual([]);
	});
});

describe("useToast outside the dashboard", () => {
	it("does nothing", () => {
		cleanup();
		render(<Grab />);
		expect(api.show("Hello")).toBe("");
		expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
	});
});
