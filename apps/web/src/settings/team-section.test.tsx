import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "../lib/billing.ts";
import type { PendingInvite, TeamMember } from "../lib/team.ts";
import { createAppRouter } from "../router.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
	RedirectToSignIn: () => null,
	UserButton: () => null,
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
			return Response.json({ url: "https://lucidhire.io/invite/tok_abc", expiresAt: "2026-10-29T10:00:00.000Z" }, { status: 201 });
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

function renderSettings() {
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dashboard/settings"] }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

const team = () => screen.findByRole("region", { name: "Team" }, { timeout: 5000 });

describe("the team section", () => {
	it("lists the people with initials, a You tag and when they joined", async () => {
		renderSettings();
		const section = await team();
		expect(section.id).toBe("team");
		const list = await within(section).findByRole("list", { name: "Team members" });
		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(3);

		expect(within(rows[0]).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(rows[0]).getByText("You")).toBeTruthy();
		expect(within(rows[0]).getByText("AL")).toBeTruthy();
		expect(within(rows[0]).getByText(/Joined 5 Oct 2026/)).toBeTruthy();
		// No name: the email stands in. No email either: "Unnamed member".
		expect(within(rows[1]).getByText("ben@example.com")).toBeTruthy();
		expect(within(rows[2]).getByText("Unnamed member")).toBeTruthy();
	});

	it("lets an admin change a role", async () => {
		renderSettings();
		const section = await team();
		const select = await within(section).findByLabelText("Role for ben@example.com");
		expect((select as HTMLSelectElement).value).toBe("member");

		fireEvent.change(select, { target: { value: "admin" } });
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:8787/team/user_2",
				expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
			),
		);
		await waitFor(() => expect((within(section).getByLabelText("Role for ben@example.com") as HTMLSelectElement).value).toBe("admin"));
	});

	it("shows the last-admin message and keeps the role", async () => {
		roleReply = () =>
			Response.json(
				{ error: { code: "last_admin", message: "This is the only admin. Promote someone else before changing this role." } },
				{ status: 409 },
			);
		renderSettings();
		const section = await team();
		const select = await within(section).findByLabelText("Role for Ada Lovelace");
		fireEvent.change(select, { target: { value: "member" } });

		expect((await within(section).findByRole("alert")).textContent).toContain(
			"This is the only admin. Promote someone else before changing this role.",
		);
		await waitFor(() => expect((within(section).getByLabelText("Role for Ada Lovelace") as HTMLSelectElement).value).toBe("admin"));
	});

	it("shows members the roster with roles as text and no controls", async () => {
		role = "member";
		renderSettings();
		const section = await team();
		await within(section).findByRole("list", { name: "Team members" });
		expect(within(section).queryByRole("combobox")).toBeNull();
		expect(within(section).queryByRole("button")).toBeNull();
		expect(within(section).getAllByText("Admin").length).toBe(1);
	});

	it("shows an error with a retry when the team can't be loaded", async () => {
		const answer = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url, init) =>
			new URL(url).pathname === "/team" ? Response.json({ error: { message: "Something went wrong" } }, { status: 500 }) : answer(url, init),
		);
		renderSettings();
		const section = await team();
		expect(await within(section).findByText(/Something went wrong/)).toBeTruthy();
		expect(within(section).getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("inviting a teammate", () => {
	it("creates a link, copies it, and lists it as pending until it is revoked", async () => {
		const copy = vi.fn(async () => {});
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: copy } });
		renderSettings();
		const section = await team();

		fireEvent.click(await within(section).findByRole("button", { name: "Create invite link" }));
		const link = (await within(section).findByLabelText("Invite link")) as HTMLInputElement;
		expect(link.value).toBe("https://lucidhire.io/invite/tok_abc");
		expect(within(section).getByText(/Expires 29 Oct 2026/)).toBeTruthy();

		fireEvent.click(within(section).getByRole("button", { name: "Copy link" }));
		await waitFor(() => expect(copy).toHaveBeenCalledWith("https://lucidhire.io/invite/tok_abc"));
		expect(await within(section).findByText(/Copied\./)).toBeTruthy();

		expect(await within(section).findByText(/Link created 22 Oct 2026 · expires 29 Oct 2026/)).toBeTruthy();
		fireEvent.click(within(section).getByRole("button", { name: /Revoke the invite/ }));
		await waitFor(() => expect(within(section).queryByText(/Link created/)).toBeNull());
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/team/invites/hash_1", expect.objectContaining({ method: "DELETE" }));
	});

	it("says when the link can't be copied automatically", async () => {
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async () => Promise.reject(new Error("blocked")) } });
		renderSettings();
		const section = await team();
		fireEvent.click(await within(section).findByRole("button", { name: "Create invite link" }));
		fireEvent.click(await within(section).findByRole("button", { name: "Copy link" }));
		expect(await within(section).findByText(/Couldn't copy/)).toBeTruthy();
	});

	it("is not offered to members", async () => {
		role = "member";
		renderSettings();
		const section = await team();
		await within(section).findByRole("list", { name: "Team members" });
		expect(within(section).queryByRole("button", { name: "Create invite link" })).toBeNull();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/team/invites"), expect.anything());
	});
});
