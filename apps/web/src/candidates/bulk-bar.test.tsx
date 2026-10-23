import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast.tsx";
import { BulkBar } from "./bulk-bar.tsx";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

type Body = { ids: string[]; decision?: string };

// Answers the bulk endpoints the way the API does: only CVs whose decision changed come back.
function stubApi(answer?: (path: string, body: Body) => Response | Promise<Response>) {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const body = init?.body ? (JSON.parse(String(init.body)) as Body) : { ids: [] };
		if (answer) return answer(path, body);
		if (path.endsWith("/candidates/decisions")) {
			return Response.json({
				updated: body.ids.map((id) => ({ id, jobId: "job_1", decision: body.decision, previous: "undecided" })),
			});
		}
		return Response.json({ deleted: body.ids.map((id) => ({ id, jobId: "job_1" })) });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function renderBar(props: Partial<Parameters<typeof BulkBar>[0]> = {}) {
	const onClear = vi.fn();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<main>
					<BulkBar selectedIds={["c1", "c2", "c3"]} onClear={onClear} isAdmin={false} {...props} />
				</main>
			</ToastProvider>
		</QueryClientProvider>,
	);
	return { ...view, onClear };
}

const bar = () => screen.getByRole("region", { name: "Selected candidates" });
const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));
const sent = (fetchMock: ReturnType<typeof stubApi>, index = 0) => {
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
	return { path: new URL(url).pathname, body: JSON.parse(String(init.body)) };
};

describe("BulkBar", () => {
	it("isn't there while nothing is checked", () => {
		stubApi();
		renderBar({ selectedIds: [] });
		expect(screen.queryByRole("region", { name: "Selected candidates" })).toBeNull();
	});

	it("says how many are checked, politely, and offers the decisions and Clear", () => {
		stubApi();
		const { onClear } = renderBar();
		expect(within(bar()).getByRole("status").textContent).toBe("3 selected");
		for (const name of ["Shortlist", "Not a fit", "Undecided"]) expect(within(bar()).getByRole("button", { name })).toBeTruthy();
		// Delete is for admins, Export needs a job.
		expect(within(bar()).queryByRole("button", { name: /delete/i })).toBeNull();
		expect(within(bar()).queryByRole("button", { name: /export/i })).toBeNull();
		fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
		expect(onClear).toHaveBeenCalled();
	});

	it("shortlists the checked CVs, clears the selection and offers an undo that puts the old decisions back", async () => {
		const fetchMock = stubApi();
		const { onClear } = renderBar();
		fireEvent.click(within(bar()).getByRole("button", { name: "Shortlist" }));

		await waitFor(() => expect(onClear).toHaveBeenCalled());
		expect(sent(fetchMock)).toEqual({ path: "/candidates/decisions", body: { ids: ["c1", "c2", "c3"], decision: "shortlisted" } });
		expect(toasts().getByText("Shortlisted 3 candidates")).toBeTruthy();

		fireEvent.click(toasts().getByRole("button", { name: "Undo" }));
		await waitFor(() => expect(toasts().getByText("Undone · 3 candidates back as before")).toBeTruthy());
		expect(sent(fetchMock, 1)).toEqual({ path: "/candidates/decisions", body: { ids: ["c1", "c2", "c3"], decision: "undecided" } });
	});

	it("says when some or all of the CVs already had the decision", async () => {
		stubApi((_path, { ids }) =>
			Response.json({ updated: ids.slice(1).map((id) => ({ id, jobId: "job_1", decision: "rejected", previous: "shortlisted" })) }),
		);
		renderBar();
		fireEvent.click(within(bar()).getByRole("button", { name: "Not a fit" }));
		await waitFor(() => expect(toasts().getByText("Marked 2 candidates not a fit · 1 already was")).toBeTruthy());
	});

	it("looks busy while saving, keeps focus, ignores a second click and keeps the selection when the API refuses", async () => {
		let refuse = () => {};
		const fetchMock = stubApi(
			() =>
				new Promise((resolve) => {
					refuse = () => resolve(Response.json({ error: "Something went wrong" }, { status: 500 }));
				}),
		);
		const { onClear } = renderBar();
		const button = within(bar()).getByRole("button", { name: "Undecided" });
		button.focus();
		fireEvent.click(button);
		await waitFor(() => expect(button.textContent).toBe("Saving"));
		expect(button.getAttribute("aria-disabled")).toBe("true");
		expect(document.activeElement).toBe(button);
		fireEvent.click(within(bar()).getByRole("button", { name: "Shortlist" }));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(async () => refuse());
		await waitFor(() => expect(toasts().getByText(/back to/).textContent).toContain("Couldn't move 3 candidates back to undecided"));
		expect(onClear).not.toHaveBeenCalled();
		expect(button.getAttribute("aria-disabled")).toBe("false");
	});

	it("lets an admin delete the checked CVs after confirming with the count", async () => {
		const fetchMock = stubApi();
		const { onClear } = renderBar({ isAdmin: true });
		fireEvent.click(within(bar()).getByRole("button", { name: "Delete 3 candidates" }));

		const dialog = screen.getByRole("alertdialog", { name: "Delete 3 candidates?" });
		expect(dialog.textContent).toContain("You can't undo this.");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete 3 candidates" }));

		await waitFor(() => expect(onClear).toHaveBeenCalled());
		expect(sent(fetchMock)).toEqual({ path: "/candidates/delete", body: { ids: ["c1", "c2", "c3"] } });
		expect(toasts().getByText("Deleted 3 candidates")).toBeTruthy();
	});

	it("shows why a delete failed in the dialog", async () => {
		stubApi(() => Response.json({ error: "Only admins can do that", code: "forbidden" }, { status: 403 }));
		const { onClear } = renderBar({ isAdmin: true });
		fireEvent.click(within(bar()).getByRole("button", { name: "Delete 3 candidates" }));
		const dialog = screen.getByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete 3 candidates" }));
		await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Only admins can delete candidates."));
		expect(onClear).not.toHaveBeenCalled();
	});

	it("hands focus back to the list when it leaves while focused", async () => {
		stubApi();
		function List() {
			const [ids, setIds] = useState(["c1", "c2"]);
			const selectAll = useRef<HTMLButtonElement>(null);
			return (
				<>
					<button ref={selectAll} type="button">
						Select all
					</button>
					<BulkBar selectedIds={ids} onClear={() => setIds([])} isAdmin={false} returnFocus={selectAll} />
				</>
			);
		}
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<List />
			</QueryClientProvider>,
		);
		const clear = within(bar()).getByRole("button", { name: "Clear selection" });
		clear.focus();
		fireEvent.click(clear);
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Select all" })));
	});

	it("exports the job's CSV from a menu when it's on a job", async () => {
		const fetchMock = stubApi(() => new Response("Rank,Name\n", { headers: { "Content-Type": "text/csv" } }));
		const createObjectURL = vi.fn(() => "blob:csv");
		vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
		const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
		renderBar({ exportJobId: "job_1" });
		fireEvent.click(within(bar()).getByRole("button", { name: "Export CSV" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Shortlisted" }));
		await waitFor(() => expect(toasts().getByText("Downloaded the job's CSV · Shortlisted")).toBeTruthy());
		expect(String(fetchMock.mock.calls[0][0])).toContain("/jobs/job_1/candidates/export.csv?decision=shortlisted");
		expect(download).toHaveBeenCalled();
		download.mockRestore();
	});
});
