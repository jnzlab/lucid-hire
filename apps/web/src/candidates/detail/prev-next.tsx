import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useHotkeys } from "../../lib/hotkeys.ts";
import { Tooltip } from "../../ui/tooltip.tsx";
import type { CandidateSearch, Place } from "./job-view.ts";

const STEP = "icon-btn icon-btn-outline text-ink";

// "‹ 2 of 14 ›": the candidate's place in the job page's list (in its filter, search and order), with links to the
// one before and after, and J and K for the same. Moving on replaces the history entry, so Back still goes to the job.
export function PrevNext({ jobId, place, view }: { jobId: string; place: Place; view: CandidateSearch }) {
	const navigate = useNavigate();
	const go = (candidateId: string | null) => {
		if (!candidateId) return;
		void navigate({
			to: "/dashboard/jobs/$jobId/candidates/$candidateId",
			params: { jobId, candidateId },
			search: view,
			replace: true,
		});
	};
	useHotkeys([
		{ keys: "j", label: "Next candidate", group: "Job triage", run: () => go(place.next) },
		{ keys: "k", label: "Previous candidate", group: "Job triage", run: () => go(place.previous) },
	]);

	const step = (candidateId: string | null, label: string, key: string, icon: ReactNode) =>
		candidateId ? (
			<Tooltip
				content={
					<>
						{label}
						<span className="ml-2 text-paper/70">{key.toUpperCase()}</span>
					</>
				}
				describe={false}
			>
				<Link
					to="/dashboard/jobs/$jobId/candidates/$candidateId"
					params={{ jobId, candidateId }}
					search={view}
					replace
					aria-keyshortcuts={key.toUpperCase()}
					className={STEP}
				>
					{icon}
					<span className="sr-only">{label}</span>
				</Link>
			</Tooltip>
		) : (
			<button type="button" disabled className={`${STEP} cursor-not-allowed opacity-40`}>
				{icon}
				<span className="sr-only">{label}</span>
			</button>
		);

	return (
		<nav aria-label="Candidates in this job" className="flex flex-none items-center gap-1.5">
			{step(place.previous, "Previous candidate", "k", <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />)}
			<p className="min-w-[4.5em] text-center font-mono text-[13px] text-ink-2 tabular-nums">
				<span className="sr-only">Candidate </span>
				{place.index + 1} of {place.total}
			</p>
			{step(place.next, "Next candidate", "j", <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />)}
		</nav>
	);
}
