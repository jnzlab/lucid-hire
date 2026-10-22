import { useAuth } from "@clerk/react";

// The signed-in user, and a fresh Clerk session token for each API call.
export function useSession() {
	const { getToken, userId } = useAuth();
	return { userId, token: () => getToken() };
}
