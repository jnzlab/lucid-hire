import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";
import { type Org, meQueryKey } from "./me.ts";
import { useSession } from "./session.ts";

export type Role = "admin" | "member";
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Member" };

export type TeamMember = {
	userId: string;
	role: Role;
	name: string | null;
	email: string | null;
	imageUrl: string | null;
	joinedAt: string;
	isYou: boolean;
};
export type PendingInvite = { id: string; createdAt: string; expiresAt: string; createdBy: string };

export const teamKey = (userId: string | null | undefined) => ["team", userId] as const;
const invitesKey = (userId: string | null | undefined) => ["team-invites", userId] as const;

// How a person is named on screen: their name, else their email, else "Unnamed member".
export function displayName(member: Pick<TeamMember, "name" | "email">): string {
	return member.name ?? member.email ?? "Unnamed member";
}

export function initials(member: Pick<TeamMember, "name" | "email">): string {
	const source = member.name ?? member.email ?? "";
	const letters = source.split(/[\s@.]+/).filter(Boolean).slice(0, 2);
	return letters.map((part) => part[0].toUpperCase()).join("") || "?";
}

export function useTeam() {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: teamKey(userId),
		queryFn: async ({ signal }) => (await apiGet<{ members: TeamMember[] }>("/team", { token: await token(), signal })).members,
		staleTime: 60_000,
	});
}

export function useChangeRole() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ memberId, role }: { memberId: string; role: Role }) =>
			apiPatch<{ member: { userId: string; role: Role } }>(`/team/${encodeURIComponent(memberId)}`, { role }, { token: await token() }),
		onSettled: (_data, _error, { memberId }) => {
			void queryClient.invalidateQueries({ queryKey: teamKey(userId) });
			// Changing your own role changes what the whole dashboard lets you do.
			if (memberId === userId) void queryClient.invalidateQueries({ queryKey: meQueryKey(userId) });
		},
	});
}

export function useInvites(enabled: boolean) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: invitesKey(userId),
		queryFn: async ({ signal }) => (await apiGet<{ invites: PendingInvite[] }>("/team/invites", { token: await token(), signal })).invites,
		enabled,
	});
}

export function useCreateInvite() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => apiPost<{ id: string; url: string; expiresAt: string }>("/team/invites", undefined, { token: await token() }),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey(userId) }),
	});
}

export function useRevokeInvite() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => apiDelete(`/team/invites/${encodeURIComponent(id)}`, { token: await token() }),
		onSettled: () => void queryClient.invalidateQueries({ queryKey: invitesKey(userId) }),
	});
}

// The company an invite link leads to.
export function useInvite(token: string, enabled: boolean) {
	const session = useSession();
	return useQuery({
		queryKey: ["invite", token],
		queryFn: async ({ signal }) =>
			apiGet<{ company: { name: string } }>(`/invites/${encodeURIComponent(token)}`, { token: await session.token(), signal }),
		enabled,
		retry: false,
	});
}

export function useAcceptInvite(token: string) {
	const { userId, token: sessionToken } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () =>
			apiPost<{ org: Org }>(`/invites/${encodeURIComponent(token)}/accept`, undefined, { token: await sessionToken() }),
		// Saving the company into the cached account is what sends them to the dashboard.
		onSuccess: ({ org }) =>
			queryClient.setQueryData(meQueryKey(userId), (me: { userId: string; org: Org | null } | undefined) => me && { ...me, org }),
	});
}
