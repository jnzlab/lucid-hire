import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "../lib/billing.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	// The dashboard's account menu reads the name and email; without a user it shows "Your account".
	useUser: () => ({ isLoaded: true, user: null }),
	RedirectToSignIn: () => null,
	UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
	UserProfile: ({ path }: { path: string }) => <p data-path={path}>Clerk profile panel</p>,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

const redirect = vi.hoisted(() => vi.fn());
vi.mock("../lib/redirect.ts", () => ({ redirectTo: redirect }));

let role: "admin" | "member";
let orgName: string;
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
let renameReply: (name: string) => Response;

beforeEach(() => {
	role = "admin";
	orgName = "Sprite Labs";
	billing = freeBilling();
	billingCalls = 0;
	checkoutReply = () => Response.json({ url: "https://sandbox.polar.sh/checkout/abc" });
	portalReply = () => Response.json({ url: "https://sandbox.polar.sh/portal/xyz" });
	renameReply = (name) => {
		orgName = name;
		return Response.json({ org: { id: "org_1", name, role } });
	};
	redirect.mockReset();
	localStorage.clear();
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: orgName, role } });
		if (path === "/billing" && method === "GET") {
			billingCalls += 1;
			return Response.json({ ...billing, isAdmin: role === "admin" });
		}
		if (path === "/billing/checkout") return checkoutReply();
		if (path === "/billing/portal") return portalReply();
		if (path === "/orgs/current" && method === "PATCH") return renameReply((JSON.parse(init?.body as string) as { name: string }).name);
		if (path === "/team") {
			return Response.json({
				members: [
					{ userId: "user_1", role: "admin", name: "Ada Lovelace", email: "ada@example.com", imageUrl: null, joinedAt: "2026-10-05T09:00:00.000Z", isYou: true },
					{ userId: "user_2", role: "member", name: null, email: "ben@example.com", imageUrl: null, joinedAt: "2026-10-12T09:00:00.000Z", isYou: false },
				],
			});
		}
		if (path === "/team/invites") return Response.json({ invites: [] });
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

const main = () => within(screen.getByRole("main"));
const settingsNav = () => screen.findByRole("navigation", { name: "Settings" }, { timeout: 5000 });
// The Current plan card shows from the first paint; this waits for its body to load as well.
const currentPlan = async () => {
	const section = await screen.findByRole("region", { name: "Current plan" }, { timeout: 5000 });
	await waitFor(() => expect(within(section).queryByText("Loading your plan")).toBeNull(), { timeout: 5000 });
	return section;
};
const plans = () => screen.findByRole("region", { name: "Compare plans" }, { timeout: 5000 });

describe("the settings layout", () => {
	it("shows the h1 and a tab bar of links, marking the current one", async () => {
		renderAt("/dashboard/settings/team");
		expect(await screen.findByRole("heading", { level: 1, name: "Settings" }, { timeout: 5000 })).toBeTruthy();
		const nav = await settingsNav();
		const link = (name: string) => within(nav).getByRole("link", { name });
		expect(link("Company").getAttribute("href")).toBe("/dashboard/settings");
		expect(link("Plan & billing").getAttribute("href")).toBe("/dashboard/settings/billing");
		expect(link("Team").getAttribute("href")).toBe("/dashboard/settings/team");
		expect(link("Account").getAttribute("href")).toBe("/dashboard/settings/account");
		expect(link("Team").getAttribute("aria-current")).toBe("page");
		expect(link("Company").getAttribute("aria-current")).toBeNull();
	});

	it("moves between sub-pages without losing the layout", async () => {
		const router = renderAt("/dashboard/settings");
		const nav = await settingsNav();
		fireEvent.click(within(nav).getByRole("link", { name: "Plan & billing" }));
		await currentPlan();
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
		expect(within(nav).getByRole("link", { name: "Plan & billing" }).getAttribute("aria-current")).toBe("page");
		expect(document.title).toBe("Plan & billing · LucidHire");
	});
});

describe("old settings addresses", () => {
	it("sends Polar's return to Plan & billing with the same search, and still waits for the plan", async () => {
		const router = renderAt("/dashboard/settings?checkout=success");
		await currentPlan();
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
		expect(router.state.location.search).toEqual({ checkout: "success" });
		expect(await screen.findByText("Payment received. Activating your plan…")).toBeTruthy();
	});

	it("sends a picked plan to Plan & billing", async () => {
		const router = renderAt("/dashboard/settings?upgrade=pro");
		await plans();
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
		expect(router.state.location.search).toEqual({ upgrade: "pro" });
	});

	it("follows the old #plan and #team anchors to their pages", async () => {
		let router = renderAt("/dashboard/settings#plan");
		await currentPlan();
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
		cleanup();

		router = renderAt("/dashboard/settings#team");
		await screen.findByRole("list", { name: "Team members" }, { timeout: 5000 });
		expect(router.state.location.pathname).toBe("/dashboard/settings/team");
	});

	it("moves Clerk's old profile pages under Account, and leaves the settings pages alone", async () => {
		let router = renderAt("/dashboard/settings/security");
		expect(await screen.findByText("Clerk profile panel", {}, { timeout: 5000 })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/dashboard/settings/account/security");
		cleanup();

		router = renderAt("/dashboard/settings/billing");
		await currentPlan();
		expect(router.state.location.pathname).toBe("/dashboard/settings/billing");
	});
});

describe("Company", () => {
	it("shows the name, your role, the team and the plan at a glance", async () => {
		renderAt("/dashboard/settings");
		const field = (await screen.findByLabelText("Company name", {}, { timeout: 5000 })) as HTMLInputElement;
		expect(field.value).toBe("Sprite Labs");
		expect(main().getByText("Admin")).toBeTruthy();
		expect(await main().findByText("2 people · 1 admin")).toBeTruthy();
		expect(main().getByRole("link", { name: /Invite people and manage roles/ }).getAttribute("href")).toBe("/dashboard/settings/team");

		const plan = await screen.findByRole("region", { name: "Plan" });
		expect(await within(plan).findByText("Free")).toBeTruthy();
		expect(within(plan).getByText("Active")).toBeTruthy();
		expect(within(plan).getByText("No card needed. Free doesn't renew or run out.")).toBeTruthy();
		expect(within(plan).getByRole("link", { name: "Manage plan" }).getAttribute("href")).toBe("/dashboard/settings/billing");
	});

	it("lets an admin rename the company, and the new name shows everywhere", async () => {
		renderAt("/dashboard/settings");
		const field = await screen.findByLabelText("Company name", {}, { timeout: 5000 });
		fireEvent.change(field, { target: { value: "  Sprite   Studio " } });
		fireEvent.click(main().getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/orgs/current"),
				expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Sprite Studio" }) }),
			),
		);
		expect(await screen.findByText("Company renamed to Sprite Studio")).toBeTruthy();
		await waitFor(() => expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Sprite Studio"));
		// The header's summary reads the company from the same cache as the sidebar.
		expect(screen.getByText(/at Sprite Studio, and your own account/)).toBeTruthy();
	});

	it("checks the name before sending it, and clears the message once it is fine", async () => {
		renderAt("/dashboard/settings");
		const field = await screen.findByLabelText("Company name", {}, { timeout: 5000 });
		fireEvent.change(field, { target: { value: "S" } });
		fireEvent.click(main().getByRole("button", { name: "Save" }));

		expect(await main().findByText("✕ Enter a company name between 2 and 80 characters.")).toBeTruthy();
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(field);
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/orgs/current"), expect.anything());

		fireEvent.change(field, { target: { value: "Sp" } });
		expect(main().queryByText(/Enter a company name/)).toBeNull();
	});

	it("shows the API's refusal under the field", async () => {
		renderAt("/dashboard/settings");
		renameReply = () => Response.json({ error: { code: "forbidden", message: "Only admins can rename the company." } }, { status: 403 });
		const field = await screen.findByLabelText("Company name", {}, { timeout: 5000 });
		fireEvent.change(field, { target: { value: "Sprite Studio" } });
		fireEvent.click(main().getByRole("button", { name: "Save" }));
		expect(await main().findByText("✕ Only admins can rename the company.")).toBeTruthy();
	});

	it("does nothing when the name hasn't changed, and Escape puts the saved name back", async () => {
		renderAt("/dashboard/settings");
		const field = (await screen.findByLabelText("Company name", {}, { timeout: 5000 })) as HTMLInputElement;
		expect(main().getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(main().getByRole("button", { name: "Save" }));
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/orgs/current"), expect.anything());

		fireEvent.change(field, { target: { value: "Something else" } });
		expect(main().getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("false");
		fireEvent.keyDown(field, { key: "Escape" });
		expect(field.value).toBe("Sprite Labs");
	});

	it("shows members the name as text and says who can change it", async () => {
		role = "member";
		renderAt("/dashboard/settings");
		expect(await screen.findByText("Only admins can rename the company.", {}, { timeout: 5000 })).toBeTruthy();
		expect(main().queryByLabelText("Company name")).toBeNull();
		expect(main().getByText("Member")).toBeTruthy();
		expect(await main().findByRole("link", { name: /See who's on the team/ })).toBeTruthy();
		expect(await main().findByRole("link", { name: "See plan and usage" })).toBeTruthy();
	});
});

describe("Plan & billing", () => {
	it("shows the plan, its status and the usage meters", async () => {
		renderAt("/dashboard/settings/billing");
		const section = await currentPlan();
		expect(within(section).getByText("Free")).toBeTruthy();
		expect(within(section).getByText("Active")).toBeTruthy();

		const usage = screen.getByRole("region", { name: "Usage" });
		const jobs = within(usage).getByRole("meter", { name: "New jobs this month" });
		expect(jobs.getAttribute("aria-valuenow")).toBe("3");
		expect(jobs.getAttribute("aria-valuemax")).toBe("10");
		expect(within(usage).getByText("3 of 10")).toBeTruthy();
		expect(within(usage).getByRole("meter", { name: "CVs on the busiest job" }).getAttribute("aria-valuetext")).toBe("4 of 10");
		expect(within(usage).getByRole("link", { name: "Senior iOS Engineer" }).getAttribute("href")).toBe("/dashboard/jobs/job_1");
		expect(within(usage).getByText(/Every job reads up to 10 free CVs/)).toBeTruthy();
		expect(within(usage).getByText("5 of 30")).toBeTruthy();
	});

	it("shows Unlimited with the number created on Max, and CVs without 'free'", async () => {
		billing = paid("max", {}, { jobsThisMonth: 25, busiestJob: { id: "j", title: "Big role", cvCount: 120 } });
		renderAt("/dashboard/settings/billing");
		await currentPlan();
		const usage = screen.getByRole("region", { name: "Usage" });
		expect(within(usage).getByText("Unlimited · 25 created")).toBeTruthy();
		expect(within(usage).queryByRole("meter", { name: "New jobs this month" })).toBeNull();
		expect(within(usage).getByText("120 of 1,000")).toBeTruthy();
		expect(within(usage).getByText(/Every job reads up to 1,000 CVs/)).toBeTruthy();
	});

	it("warns at the limit, not only past it", async () => {
		billing = freeBilling({}, { jobsThisMonth: 10, busiestJob: { id: "j", title: "Full role", cvCount: 10 } });
		renderAt("/dashboard/settings/billing");
		await currentPlan();
		const usage = screen.getByRole("region", { name: "Usage" });
		expect(within(usage).getByText(/Limit reached\. Deleting a job does not give the slot back/)).toBeTruthy();
		expect(within(usage).getByText(/Limit reached on this job/)).toBeTruthy();
	});

	it("names the status: overdue, ending and ended", async () => {
		billing = paid("pro", { status: "past_due" });
		renderAt("/dashboard/settings/billing");
		let section = await currentPlan();
		expect(within(section).getByText("Payment overdue")).toBeTruthy();
		expect(within(section).getByRole("alert").textContent).toContain("Your last payment failed.");
		cleanup();

		billing = paid("pro", { cancelAtPeriodEnd: true });
		renderAt("/dashboard/settings/billing");
		section = await currentPlan();
		expect(within(section).getByText("Cancels on 22 Nov 2026")).toBeTruthy();
		expect(within(section).getByText(/Ends on 22 Nov 2026, then you're on Free\. You can undo this in the billing portal\./)).toBeTruthy();
		cleanup();

		billing = freeBilling({ plan: "pro", status: "canceled" });
		renderAt("/dashboard/settings/billing");
		section = await currentPlan();
		expect(within(section).getByText("Ended")).toBeTruthy();
		expect(within(section).getByText("Your Pro plan has ended. You're on Free now.")).toBeTruthy();
	});

	it("lets an admin upgrade: checkout opens, and the cards show Current plan and Upgrade", async () => {
		renderAt("/dashboard/settings/billing");
		const list = await plans();
		const pro = within(within(list).getByRole("listitem", { name: "Pro plan" }));
		expect(within(list).getByRole("listitem", { name: "Free plan" }).textContent).toContain("Current plan");
		expect(pro.getByText("100 CVs per job")).toBeTruthy();
		expect(pro.getByText("$10")).toBeTruthy();

		fireEvent.click(pro.getByRole("button", { name: "Upgrade to Pro" }));
		await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/abc"));
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/billing/checkout"),
			expect.objectContaining({ method: "POST", body: JSON.stringify({ plan: "pro" }) }),
		);
	});

	it("offers the next plan on the upgrade band to admins on Free", async () => {
		renderAt("/dashboard/settings/billing");
		const band = await screen.findByRole("region", { name: "Read 100 CVs a job with Pro" }, { timeout: 5000 });
		expect(within(band).getByText("On Free · 10 CVs a job")).toBeTruthy();
		fireEvent.click(within(band).getByRole("button", { name: "Upgrade to Pro" }));
		await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/abc"));
	});

	it("leads the band with the limit that is running out", async () => {
		billing = paid("pro", {}, { busiestJob: { id: "j", title: "Big role", cvCount: 95 } });
		renderAt("/dashboard/settings/billing");
		const band = await screen.findByRole("region", { name: "Read 1,000 CVs a job with Max" }, { timeout: 5000 });
		expect(within(band).getByText("Big role has used 95 of its 100 CVs")).toBeTruthy();
	});

	it("keeps the band away from a paying company with room to spare, and from members", async () => {
		billing = paid("pro");
		renderAt("/dashboard/settings/billing");
		await plans();
		expect(screen.queryByRole("region", { name: /Read .* CVs a job/ })).toBeNull();
		cleanup();

		role = "member";
		billing = freeBilling();
		renderAt("/dashboard/settings/billing");
		await plans();
		expect(screen.queryByRole("region", { name: /Read .* CVs a job/ })).toBeNull();
	});

	it("changes a paying company's plan in place and waits until it shows", async () => {
		billing = paid("pro");
		checkoutReply = () => Response.json({ changed: true, plan: "max" });
		renderAt("/dashboard/settings/billing");
		const list = await plans();
		fireEvent.click(within(within(list).getByRole("listitem", { name: "Max plan" })).getByRole("button", { name: "Upgrade to Max" }));

		const section = await currentPlan();
		expect(await within(section).findByText("Changing your plan to Max…")).toBeTruthy();
		expect(redirect).not.toHaveBeenCalled();
		billing = paid("max");
		await waitFor(() => expect(billingCalls).toBeGreaterThan(1), { timeout: 5000 });
		expect(await within(section).findByText("You're on Max now.", {}, { timeout: 5000 })).toBeTruthy();
	}, 15_000);

	it("points downgrades at the billing portal", async () => {
		billing = paid("max");
		renderAt("/dashboard/settings/billing");
		const list = await plans();
		expect(within(list).getByRole("button", { name: "Switch to Pro in the billing portal" })).toBeTruthy();
		fireEvent.click(within(list).getByRole("button", { name: "Switch to Free in the billing portal" }));
		await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sandbox.polar.sh/portal/xyz"));
	});

	it("opens the billing portal from Manage billing, and shows an error next to it when it fails", async () => {
		billing = paid("pro");
		portalReply = () => Response.json({ error: { code: "billing_unavailable", message: "Billing is down" } }, { status: 502 });
		renderAt("/dashboard/settings/billing");
		const section = await currentPlan();
		fireEvent.click(within(section).getByRole("button", { name: "Manage billing" }));
		expect((await within(section).findByRole("alert")).textContent).toContain("Billing is down");
	});

	it("shows members everything read-only, with no buttons to change the plan", async () => {
		role = "member";
		billing = paid("pro");
		renderAt("/dashboard/settings/billing");
		const section = await currentPlan();
		expect(within(section).getByText("Only admins can change the plan.")).toBeTruthy();
		const list = await plans();
		expect(within(list).getByText("Only admins can change the plan. Ask one of them if you need more room.")).toBeTruthy();
		expect(main().queryByRole("button")).toBeNull();
		expect(within(list).getByRole("listitem", { name: "Pro plan" }).textContent).toContain("Current plan");
	});

	it("highlights the plan picked before sign-up, without sending anyone to payment", async () => {
		renderAt("/dashboard/settings/billing?upgrade=pro");
		const list = await plans();
		const pro = within(list).getByRole("listitem", { name: "Pro plan" });
		expect(pro.textContent).toContain("You picked Pro");
		expect(within(pro).getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "Read 100 CVs a job with Pro" }).textContent).toContain("You picked Pro");
		expect(redirect).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/billing/checkout"), expect.anything());
	});

	it("ignores a picked plan the company is already on", async () => {
		billing = paid("pro");
		renderAt("/dashboard/settings/billing?upgrade=pro");
		const list = await plans();
		expect(within(list).getByRole("listitem", { name: "Pro plan" }).textContent).not.toContain("You picked");
	});

	it("shows an error with a retry when the plan can't be loaded", async () => {
		fetchMock.mockImplementation(async (url: string) =>
			new URL(url).pathname === "/me"
				? Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } })
				: Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }),
		);
		renderAt("/dashboard/settings/billing");
		const section = await currentPlan();
		expect(await within(section).findByText(/Something went wrong/)).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("after checkout", () => {
	it("says the payment arrived and waits until the plan is active", async () => {
		renderAt("/dashboard/settings/billing?checkout=success");
		const section = await currentPlan();
		expect(await within(section).findByText("Payment received. Activating your plan…")).toBeTruthy();
		// No upgrade band while the payment is landing.
		expect(screen.queryByRole("region", { name: /Read .* CVs a job/ })).toBeNull();

		billing = paid("pro");
		expect(await within(section).findByText("Your Pro plan is active.", {}, { timeout: 6000 })).toBeTruthy();
	}, 15_000);

	it("stops waiting after a minute with a message, so it is never stuck", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		renderAt("/dashboard/settings/billing?checkout=success");
		const section = await currentPlan();
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

describe("Account", () => {
	it("shows Clerk's profile, which routes under the account page, and leaves the theme to the account menu", async () => {
		renderAt("/dashboard/settings/account");
		const profile = await screen.findByText("Clerk profile panel", {}, { timeout: 5000 });
		expect(profile.getAttribute("data-path")).toBe("/dashboard/settings/account");
		expect(document.title).toBe("Account · LucidHire");
		expect(screen.queryByRole("radiogroup", { name: "Appearance" })).toBeNull();
	});
});
