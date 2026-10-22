import { RedirectToSignIn, useAuth } from "@clerk/react";
import type { ReactNode } from "react";
import { PageLoading } from "../components/page-state.tsx";

// Signed-out visitors go to the sign-in page, which brings them back here afterwards.
export function RequireSession({ children }: { children: ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	if (!isLoaded) return <PageLoading label="Checking your session" />;
	if (!isSignedIn) return <RedirectToSignIn />;
	return children;
}
