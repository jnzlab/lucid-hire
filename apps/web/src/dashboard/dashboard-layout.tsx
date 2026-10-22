import { Navigate, Outlet } from "@tanstack/react-router";
import { RequireSession } from "../auth/require-session.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { useMe } from "../lib/me.ts";
import { AppShell } from "./app-shell.tsx";
import { OrgContext } from "./org.ts";

// Every page under /dashboard: a session, then a company, then the app shell around the page.
export function DashboardLayout() {
	return (
		<RequireSession>
			<WithOrg />
		</RequireSession>
	);
}

// Recruiters without a company yet are sent to onboarding first.
function WithOrg() {
	const me = useMe();
	if (me.isPending) return <PageLoading label="Opening your dashboard" />;
	if (me.isError) return <PageError message={me.error.message} onRetry={() => void me.refetch()} />;
	if (!me.data.org) return <Navigate to="/onboarding" replace />;

	return (
		<OrgContext value={me.data.org}>
			<AppShell org={me.data.org}>
				<Outlet />
			</AppShell>
		</OrgContext>
	);
}
