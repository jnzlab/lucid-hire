import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "../lib/billing.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	RedirectToSignIn: () => null,
	UserButton: () => null,
	UserProfile: () => <p>Clerk profile panel</p>,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

const redirect = vi.hoisted(() => vi.fn());
vi.mock("../lib/redirect.ts", () => ({ redirectTo: redirect }));

let role: "admin" | "member";
let billing: Billing;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const freeBilling = (over: Partial<Billing> = {}, usage: Partial<Billing["usage"]> = {}): Billing => ({
	plan: "free",
	effectivePlan: "free",
	status: null,
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
	isAdmin: role === "admin",
	usage: {
		jobsThisMonth: 3,
		jobsLimit: 10,
		busiestJob: { id: "job_1", title: "Senior iOS Engineer", cvCount: 4 },
		cvLimit: 10,
		aiThisHour: 5,
		aiLimit: 30,
		...usage,
	},
	...over,
});
const paid = (plan: "pro" | "max", over: Partial<Billing> = {}, usage: Partial<Billing["usage"]> = {}) =>
	freeBilling(
		{
			plan,
			effectivePlan: plan,
			status: "active",
			currentPeriodEnd: "2026-11-22T10:00:00.000Z",
			...over,
		},
		{
			jobsLimit: plan === "max" ? null : 20,
			cvLimit: plan === "max" ? 1000 : 100,
			aiLimit: plan === "max" ? 600 : 150,
			...usage,
		},
	);

let billingCalls: number;
let checkoutReply: () => Response;
let portalReply: () => Response;

beforeEach(() => {
	role = "admin";
	billing = freeBilling();
	billingCalls = 0;
	checkoutReply = () => Response.json({ url: "https://sandbox.polar.sh/checkout/abc" });
	portalReply = () => Response.json({ url: "https://sandbox.polar.sh/portal/xyz" });
	redirect.mockReset();
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } });
		if (path === "/billing" && method === "GET") {
			billingCalls += 1;
			return Response.json({ ...billing, isAdmin: role === "admin" });
		}
		if (path === "/billing/checkout") return checkoutReply();
		if (path === "/billing/portal") return portalReply();
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function renderAt(path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

const plan = () => screen.findByRole("region", { name: "Plan & usage" });

describe("the settings page", () => {
	it("shows the plan, its status and the usage meters", async () => {
		renderAt("/dashboard/settings");

		expect(await screen.findByRole("heading", { level: 1, name: "Settings" }, { timeout: 5000 })).toBeTruthy();
		const section = await plan();
		expect(section.id).toBe("plan");
		expect(within(section).getByText((_, element) => element?.tagName === "P" && element.textContent === "Current plan Free")).toBeTruthy();
		expect(within(section).getByText("Active")).toBeTruthy();

		const jobs = within(section).getByRole("meter", { name: "New jobs this month (UTC)" });
		expect(jobs.getAttribute("aria-valuenow")).toBe("3");
		expect(jobs.getAttribute("aria-valuemax")).toBe("10");
		expect(within(section).getByText("3 of 10")).toBeTruthy();
		expect(within(section).getByText("4 of 10 free CVs used")).toBeTruthy();
		expect(within(section).getByRole("link", { name: "Senior iOS Engineer" })).toBeTruthy();
		expect(within(section).getByText("5 of 30")).toBeTruthy();
		// The account panel sits below.
		expect(await screen.findByText("Clerk profile panel")).toBeTruthy();
	});

	it("shows Unlimited with the number created on Max, and CVs without 'free'", async () => {
		billing = paid("max", {}, { jobsThisMonth: 25, busiestJob: { id: "j", title: "Big role", cvCount: 120 } });
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByText("Unlimited · 25 created")).toBeTruthy();
		expect(within(section).queryByRole("meter", { name: "New jobs this month (UTC)" })).toBeNull();
		expect(within(section).getByText("120 of 1,000 CVs used")).toBeTruthy();
	});

	it("warns at the limit, not only past it", async () => {
		billing = freeBilling({}, { jobsThisMonth: 10, busiestJob: { id: "j", title: "Full role", cvCount: 10 } });
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByText(/Limit reached\. Deleting a job does not give the slot back/)).toBeTruthy();
		expect(within(section).getByText(/Limit reached ·/)).toBeTruthy();
	});

	it("names the status: overdue, ending and ended", async () => {
		billing = paid("pro", { status: "past_due" });
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByText("Payment overdue")).toBeTruthy();
		expect(within(section).getByRole("alert").textContent).toContain("Your last payment failed.");
		cleanup();

		billing = paid("pro", { cancelAtPeriodEnd: true });
		renderAt("/dashboard/settings");
		expect(await screen.findByText("Cancels on 22 Nov 2026")).toBeTruthy();
		cleanup();

		billing = freeBilling({ plan: "pro", status: "canceled" });
		renderAt("/dashboard/settings");
		expect(await screen.findByText("Ended")).toBeTruthy();
	});

	it("lets an admin upgrade: checkout opens, and the cards show Current plan and Upgrade", async () => {
		renderAt("/dashboard/settings");
		const section = await plan();
		const pro = within(await within(section).findByRole("listitem", { name: "Pro plan" }));
		expect(within(section).getByRole("listitem", { name: "Free plan" }).textContent).toContain("Current plan");
		expect(pro.getByText("100 CVs per job")).toBeTruthy();
		expect(pro.getByText("$10")).toBeTruthy();

		fireEvent.click(pro.getByRole("button", { name: "Upgrade to Pro" }));
		await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/abc"));
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8787/billing/checkout",
			expect.objectContaining({ method: "POST", body: JSON.stringify({ plan: "pro" }) }),
		);
	});

	it("changes a paying company's plan in place and waits until it shows", async () => {
		billing = paid("pro");
		checkoutReply = () => Response.json({ changed: true, plan: "max" });
		renderAt("/dashboard/settings");
		const section = await plan();
		fireEvent.click(await within(section).findByRole("button", { name: "Upgrade to Max" }));

		expect(await within(section).findByText("Changing your plan to Max…")).toBeTruthy();
		expect(redirect).not.toHaveBeenCalled();
		billing = paid("max");
		await waitFor(() => expect(billingCalls).toBeGreaterThan(1), { timeout: 5000 });
		expect(await within(section).findByText("You're on Max now.", {}, { timeout: 5000 })).toBeTruthy();
	}, 15_000);

	it("points downgrades at the billing portal", async () => {
		billing = paid("max");
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByRole("button", { name: "Switch to Pro in the billing portal" })).toBeTruthy();
		fireEvent.click(within(section).getByRole("button", { name: "Switch to Free in the billing portal" }));
		await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sandbox.polar.sh/portal/xyz"));
	});

	it("opens the billing portal from Manage billing, and shows an error when it fails", async () => {
		billing = paid("pro");
		portalReply = () => Response.json({ error: { code: "billing_unavailable", message: "Billing is down" } }, { status: 502 });
		renderAt("/dashboard/settings");
		const section = await plan();
		fireEvent.click(await within(section).findByRole("button", { name: "Manage billing" }));
		expect((await within(section).findByRole("alert")).textContent).toContain("Billing is down");
	});

	it("shows members everything read-only, with no buttons to change the plan", async () => {
		role = "member";
		billing = paid("pro");
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByText("Only admins can change the plan or roles.")).toBeTruthy();
		expect(within(section).queryByRole("button")).toBeNull();
		expect(within(section).getByRole("listitem", { name: "Pro plan" }).textContent).toContain("Current plan");
	});

	it("highlights the plan picked before sign-up, without sending anyone to payment", async () => {
		renderAt("/dashboard/settings?upgrade=pro");
		const section = await plan();
		const pro = await within(section).findByRole("listitem", { name: "Pro plan" });
		expect(pro.textContent).toContain("You picked Pro");
		expect(within(pro).getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
		expect(redirect).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/billing/checkout"), expect.anything());
	});

	it("ignores a picked plan the company is already on", async () => {
		billing = paid("pro");
		renderAt("/dashboard/settings?upgrade=pro");
		const section = await plan();
		expect((await within(section).findByRole("listitem", { name: "Pro plan" })).textContent).not.toContain("You picked");
	});

	it("shows an error with a retry when the plan can't be loaded", async () => {
		fetchMock.mockImplementation(async (url: string) =>
			new URL(url).pathname === "/me"
				? Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } })
				: Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }),
		);
		renderAt("/dashboard/settings");
		const section = await plan();
		expect(await within(section).findByText(/Something went wrong/)).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("after checkout", () => {
	it("says the payment arrived and waits until the plan is active", async () => {
		renderAt("/dashboard/settings?checkout=success");
		const section = await plan();
		expect(await within(section).findByText("Payment received. Activating your plan…")).toBeTruthy();

		billing = paid("pro");
		expect(await within(section).findByText("Your Pro plan is active.", {}, { timeout: 6000 })).toBeTruthy();
	}, 15_000);

	it("stops waiting after a minute with a message, so it is never stuck", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		renderAt("/dashboard/settings?checkout=success");
		const section = await plan();
		expect(await within(section).findByText("Payment received. Activating your plan…")).toBeTruthy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(61_000);
		});
		expect(await within(section).findByText("Still activating. This can take a minute; refresh shortly.")).toBeTruthy();
		const callsAtTimeout = billingCalls;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(billingCalls).toBe(callsAtTimeout);
	}, 20_000);
});
