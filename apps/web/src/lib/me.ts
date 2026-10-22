import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api.ts";

export type Org = { id: string; name: string; role: "admin" | "member" };
export type Me = { userId: string; org: Org | null };

export const meQueryKey = (userId: string | null | undefined) => ["me", userId] as const;

// The signed-in user and their company from the API. `org` is null until onboarding.
export function useMe() {
	const { getToken, isSignedIn, userId } = useAuth();
	return useQuery({
		queryKey: meQueryKey(userId),
		queryFn: async ({ signal }) => apiGet<Me>("/me", { token: await getToken(), signal }),
		enabled: Boolean(isSignedIn),
		staleTime: 60_000,
		retry: 1,
	});
}
