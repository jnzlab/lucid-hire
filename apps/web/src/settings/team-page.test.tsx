import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "../lib/billing.ts";
import type { PendingInvite, TeamMember } from "../lib/team.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	// The dashboard's account menu reads the name and email; without a user it shows "Your account".
	useUser: () => ({ isLoaded: true, user: null }),
	RedirectToSignIn: () => null,
	UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
	UserProfile: () => null,
	Show: () => null,
	SignIn: () => null,
	SignUp: () => null,
}));

let role: "admin" | "member";
let members: TeamMember[];
let invites: PendingInvite[];
let roleReply: (userId: string, role: string) => Response;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const person = (over: Partial<TeamMember> & { userId: string }): TeamMember => ({
	role: "member",
	name: null,
	email: null,
	imageUrl: null,
	joinedAt: "2026-10-05T09:00:00.000Z",
	isYou: false,
	...over,
});

const billing: Billing = {
	plan: "free",
	effectivePlan: "free",
	status: null,
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
	isAdmin: true,
	usage: { jobsThisMonth: 0, jobsLimit: 10, busiestJob: null, cvLimit: 10, aiThisHour: 0, aiLimit: 30 },
};

beforeEach(() => {
	role = "admin";
	members = [
		person({ userId: "user_1", role: "admin", name: "Ada Lovelace", email: "ada@example.com", isYou: true }),
		person({ userId: "user_2", role: "member", email: "ben@example.com", joinedAt: "2026-10-12T09:00:00.000Z" }),
		person({ userId: "user_3" }),
	];
	invites = [];
	roleReply = (userId, newRole) => {
		const member = members.find((candidate) => candidate.userId === userId)!;
		member.role = newRole as TeamMember["role"];
		return Response.json({ member: { userId, role: newRole } });
	};
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		const method = init?.method ?? "GET";
		if (path === "/me") return Response.json({ userId: "user_1", org: { id: "org_1", name: "Sprite Labs", role } });
		if (path === "/billing") return Response.json({ ...billing, isAdmin: role === "admin" });
		if (path === "/team" && method === "GET") return Response.json({ members });
		if (path === "/team/invites" && method === "GET") return Response.json({ invites });
		if (path === "/team/invites" && method === "POST") {
			invites.push({ id: "hash_1", createdAt: "2026-10-22T10:00:00.000Z", expiresAt: "2026-10-29T10:00:00.000Z", createdBy: "user_1" });
			return Response.json({ id: "hash_1", url: "https://lucidhire.io/invite/tok_abc", expiresAt: "2026-10-29T10:00:00.000Z" }, { status: 201 });
		}
		if (path.startsWith("/team/invites/") && method === "DELETE") {
			invites = invites.filter((invite) => invite.id !== path.split("/")[3]);
			return new Response(null, { status: 204 });
		}
		if (path.startsWith("/team/") && method === "PATCH") {
			const body = JSON.parse(init?.body as string) as { role: string };
			return roleReply(decodeURIComponent(path.split("/")[2]), body.role);
		}
		return Response.json({ error: { message: "not found" } }, { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("scrollTo", () => {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderTeam() {
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dashboard/settings/team"] }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

const membersCard = () => screen.findByRole("region", { name: /^Members/ }, { timeout: 5000 });
const invitesCard = () => screen.findByRole("region", { name: "Invite a teammate" }, { timeout: 5000 });
// Toasts are announced from a polite live list at the foot of the page.
const toasts = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!;

describe("the members card", () => {
	it("lists the people with initials, a You tag and when they joined", async () => {
		renderTeam();
		const section = await membersCard();
		const list = await within(section).findByRole("list", { name: "Team members" });
		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(3);

		expect(within(rows[0]).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(rows[0]).getByText("You")).toBeTruthy();
		expect(within(rows[0]).getByText(/ada@example\.com · Joined 5 Oct 2026/)).toBeTruthy();
		// No name: the email stands in. No email either: "Unnamed member".
		expect(within(rows[1]).getByText("ben@example.com")).toBeTruthy();
		expect(within(rows[1]).getByText("Joined 12 Oct 2026")).toBeTruthy();
		expect(within(rows[2]).getByText("Unnamed member")).toBeTruthy();
		expect(section.textContent).toContain("3");
	});

	it("lets an admin change a role from the menu, and says so", async () => {
		renderTeam();
		const section = await membersCard();
		const trigger = await within(section).findByRole("button", { name: "Role for ben@example.com: Member" });
		fireEvent.click(trigger);
		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitemradio", { name: /^Member/ }).getAttribute("aria-checked")).toBe("true");
		fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Admin/ }));

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:8787/team/user_2",
				expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
			),
		);
		expect(await within(toasts()).findByText("ben@example.com is now an admin")).toBeTruthy();
		expect(await within(section).findByRole("button", { name: "Role for ben@example.com: Admin" })).toBeTruthy();
	});

	it("does nothing when the chosen role is the current one", async () => {
		renderTeam();
		const section = await membersCard();
		fireEvent.click(await within(section).findByRole("button", { name: "Role for ben@example.com: Member" }));
		fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: /^Member/ }));
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/user_2"), expect.anything());
	});

	it("asks before an admin makes themselves a member, and keeps the role on the last-admin refusal", async () => {
		roleReply = () =>
			Response.json(
				{ error: { code: "last_admin", message: "This is the only admin. Promote someone else before changing this role." } },
				{ status: 409 },
			);
		renderTeam();
		const section = await membersCard();
		fireEvent.click(await within(section).findByRole("button", { name: "Role for Ada Lovelace: Admin" }));
		fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: /^Member/ }));

		const dialog = await screen.findByRole("alertdialog", { name: "Make yourself a member?" });
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/user_1"), expect.anything());
		fireEvent.click(within(dialog).getByRole("button", { name: "Make me a member" }));

		expect((await within(section).findByRole("alert")).textContent).toContain(
			"This is the only admin. Promote someone else before changing this role.",
		);
		expect(within(section).getByRole("button", { name: "Role for Ada Lovelace: Admin" })).toBeTruthy();
	});

	it("leaves the role alone when the admin cancels", async () => {
		renderTeam();
		const section = await membersCard();
		fireEvent.click(await within(section).findByRole("button", { name: "Role for Ada Lovelace: Admin" }));
		fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: /^Member/ }));
		fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/user_1"), expect.anything());
	});

	it("shows members the roster with roles as text and no controls", async () => {
		role = "member";
		renderTeam();
		const section = await membersCard();
		await within(section).findByRole("list", { name: "Team members" });
		expect(within(section).getByText("Only admins can invite people or change roles.")).toBeTruthy();
		expect(within(section).queryByRole("button")).toBeNull();
		expect(within(section).getAllByText("Admin")).toHaveLength(1);
		expect(within(section).getAllByText("Member")).toHaveLength(2);
	});

	it("shows an error with a retry when the team can't be loaded", async () => {
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url, init) =>
			new URL(url).pathname === "/team" ? Response.json({ error: { message: "Something went wrong" } }, { status: 500 }) : answer(url, init),
		);
		renderTeam();
		const section = await membersCard();
		expect(await within(section).findByText(/Something went wrong/)).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("inviting a teammate", () => {
	it("creates a link, copies it, and lists it as pending until it is revoked", async () => {
		const copy = vi.fn(async () => {});
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: copy } });
		renderTeam();
		const section = await invitesCard();
		expect(await within(section).findByText(/No pending invites/)).toBeTruthy();

		fireEvent.click(within(section).getByRole("button", { name: "Create invite link" }));
		const link = (await within(section).findByLabelText("Invite link")) as HTMLInputElement;
		expect(link.value).toBe("https://lucidhire.io/invite/tok_abc");
		expect(within(section).getByText("Works once · expires 29 Oct 2026")).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Create another link" })).toBeTruthy();

		fireEvent.click(within(section).getByRole("button", { name: "Copy link" }));
		await waitFor(() => expect(copy).toHaveBeenCalledWith("https://lucidhire.io/invite/tok_abc"));
		expect(await within(toasts()).findByText("Invite link copied")).toBeTruthy();

		const pending = await within(section).findByRole("list", { name: "Pending invites" });
		expect(within(pending).getByText(/Link created 22 Oct 2026 · expires 29 Oct 2026/)).toBeTruthy();
		fireEvent.click(within(pending).getByRole("button", { name: "Revoke the invite created 22 Oct 2026" }));

		// Revoking asks first; nothing is deleted until it's confirmed.
		const dialog = await screen.findByRole("alertdialog", { name: "Revoke this invite?" });
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/invites/hash_1"), expect.anything());
		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

		await waitFor(() => expect(within(section).queryByText(/Link created/)).toBeNull());
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/team/invites/hash_1", expect.objectContaining({ method: "DELETE" }));
		expect(screen.queryByRole("alertdialog")).toBeNull();
		// The revoked link is no longer offered, and the toast says why.
		expect(within(section).queryByLabelText("Invite link")).toBeNull();
		expect(await within(toasts()).findByText("Invite revoked. Its link no longer works.")).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Create invite link" })).toBeTruthy();
	});

	it("says when the link can't be copied automatically, and selects it", async () => {
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async () => Promise.reject(new Error("blocked")) } });
		renderTeam();
		const section = await invitesCard();
		fireEvent.click(await within(section).findByRole("button", { name: "Create invite link" }));
		fireEvent.click(await within(section).findByRole("button", { name: "Copy link" }));
		await waitFor(() => expect(toasts().textContent).toMatch(/Couldn't copy\. Select the link and copy it\./));
		expect(document.activeElement).toBe(within(section).getByLabelText("Invite link"));
	});

	it("is not offered to members, and their invites are never fetched", async () => {
		role = "member";
		renderTeam();
		const section = await membersCard();
		await within(section).findByRole("list", { name: "Team members" });
		expect(screen.queryByRole("region", { name: "Invite a teammate" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Create invite link" })).toBeNull();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/invites"), expect.anything());
	});
});
