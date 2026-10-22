import { Navigate } from "@tanstack/react-router";
import { RequireSession } from "../auth/require-session.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { Swipe } from "../components/swipe.tsx";
import { useMe } from "../lib/me.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AppShell } from "./app-shell.tsx";

export function DashboardPage() {
	useDocumentTitle("Jobs · LucidHire");

	return (
		<RequireSession>
			<Dashboard />
		</RequireSession>
	);
}

// Recruiters without a company yet are sent to onboarding first.
function Dashboard() {
	const me = useMe();
	if (me.isPending) return <PageLoading label="Opening your dashboard" />;
	if (me.isError) return <PageError message={me.error.message} onRetry={() => void me.refetch()} />;
	if (!me.data.org) return <Navigate to="/onboarding" replace />;

	const { org } = me.data;
	return (
		<AppShell org={org}>
			<div className="wrap py-[clamp(32px,5vw,64px)]">
				<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{org.name}</p>
				<h1 className="mt-2 font-display text-[clamp(32px,4vw,52px)] leading-[.98] font-[820] tracking-[-0.038em] [font-stretch:112%]">
					Jobs
				</h1>
				<NoJobsYet />
			</div>
		</AppShell>
	);
}

function NoJobsYet() {
	return (
		<section
			aria-labelledby="no-jobs-h"
			className="desk mt-8 flex flex-col items-center rounded-2xl px-6 py-[clamp(40px,7vw,80px)] text-center"
		>
			<div className="relative grid h-[150px] w-[220px] place-items-center" aria-hidden="true">
				<Swipe className="absolute top-1/2 left-1/2 h-auto w-[300px] max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-6" />
				<div className="relative flex h-[132px] w-[176px] flex-col gap-2.5 rounded-sheet bg-sheet p-4 shadow-sheet">
					<i className="h-2.5 w-3/5 rounded-[4px] bg-ink" />
					<i className="h-2 w-2/5 rounded-[4px] bg-line" />
					<i className="mt-2 h-2 w-full rounded-[4px] bg-line-2" />
					<i className="h-2 w-11/12 rounded-[4px] bg-line-2" />
					<i className="h-2 w-4/5 rounded-[4px] bg-line-2" />
				</div>
			</div>
			<h2 id="no-jobs-h" className="mt-8 text-[24px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:110%]">
				No jobs yet
			</h2>
			<p className="mt-3 max-w-[46ch] text-[17px] text-ink-2">
				When you post a job, every CV it gets is read in full, scored against your requirements and ranked here, with
				the evidence beside each score.
			</p>
		</section>
	);
}
