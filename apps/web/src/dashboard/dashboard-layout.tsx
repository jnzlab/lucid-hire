import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { RequireSession } from "../auth/require-session.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { useMe } from "../lib/me.ts";
import { safeReturnPath } from "../lib/return-to.ts";
import { useDashboardTheme } from "../lib/theme.ts";
import { ToastProvider } from "../ui/toast.tsx";
import { AppShell } from "./app-shell.tsx";
import { OrgContext } from "./org.ts";

// Every page under /dashboard: a session, then a company, then the app shell around the page. The dashboard's light
// or dark theme applies from the first loading screen and comes off again when you leave the dashboard.
export function DashboardLayout() {
	useDashboardTheme();
	return (
		<RequireSession>
			<ToastProvider>
				<WithOrg />
			</ToastProvider>
		</RequireSession>
	);
}

// Recruiters without a company yet are sent to onboarding first, which sends them back to the page they asked for.
function WithOrg() {
	const me = useMe();
	// The page asked for, as of the first render: this layout stays mounted while the navigation to onboarding runs.
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [asked] = useState(pathname);
	if (me.isPending) return <PageLoading label="Loading your dashboard" />;
	if (me.isError) return <PageError message={me.error.message} onRetry={() => void me.refetch()} />;
	if (!me.data.org) return <Navigate to="/onboarding" search={{ next: safeReturnPath(asked) }} replace />;

	return (
		<OrgContext value={me.data.org}>
			<AppShell org={me.data.org}>
				<Outlet />
			</AppShell>
		</OrgContext>
	);
}
