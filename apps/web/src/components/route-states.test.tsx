import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteError, RouteNotFound } from "./route-states.tsx";

const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: session.signedIn }) }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderInRouter(component: () => React.ReactNode) {
	const router = createRouter({
		routeTree: createRootRoute({ component }),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return render(<RouterProvider router={router} />);
}

describe("RouteNotFound", () => {
	it("offers only Go home to a signed-out visitor", async () => {
		session.signedIn = false;
		renderInRouter(RouteNotFound);

		expect(await screen.findByRole("heading", { level: 1, name: "✕ This page does not exist" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
		expect(screen.queryByRole("link", { name: "Open your dashboard" })).toBeNull();
	});

	it("adds Open your dashboard for a signed-in recruiter", async () => {
		session.signedIn = true;
		renderInRouter(RouteNotFound);

		expect((await screen.findByRole("link", { name: "Open your dashboard" })).getAttribute("href")).toBe("/dashboard");
		expect(screen.getByRole("link", { name: "Go home" })).toBeTruthy();
	});
});

describe("RouteError", () => {
	it("shows a short reference, logs it with the error and resets on Try again", () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const reset = vi.fn();
		const error = new Error("boom");
		render(<RouteError error={error} reset={reset} info={undefined} />);

		expect(screen.getByRole("heading", { level: 1, name: "✕ Something went wrong" })).toBeTruthy();
		const reference = /Error reference: ([0-9a-f]{8})$/.exec(screen.getByText(/Error reference:/).textContent ?? "")?.[1];
		expect(reference).toBeTruthy();
		expect(logged).toHaveBeenCalledWith(`Error reference ${reference}`, error);
		expect(screen.queryByText(/boom/)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(reset).toHaveBeenCalledOnce();
	});

	it("gives each error its own reference", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const view = render(<RouteError error={new Error("one")} reset={() => {}} info={undefined} />);
		const first = screen.getByText(/Error reference:/).textContent;
		view.rerender(<RouteError error={new Error("two")} reset={() => {}} info={undefined} />);

		expect(screen.getByText(/Error reference:/).textContent).not.toBe(first);
	});
});
