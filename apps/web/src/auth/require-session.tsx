import { RedirectToSignIn, useAuth } from "@clerk/react";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageLoading } from "../components/page-state.tsx";

// Signed-out visitors go to the sign-in page, which brings them back here afterwards. The address is passed
// explicitly, in full, so a deep link such as a job's page survives sign-in instead of landing on the dashboard.
export function RequireSession({ children }: { children: ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	const here = useRouterState({ select: (state) => state.location.href });
	if (!isLoaded) return <PageLoading label="Loading your session" />;
	if (!isSignedIn) return <RedirectToSignIn redirectUrl={`${window.location.origin}${here}`} />;
	return children;
}
