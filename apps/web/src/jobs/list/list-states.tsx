import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { JobFilters, JobStatus } from "../../lib/jobs.ts";
import { EmptyState } from "../../ui/empty-state.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";

// The company has no jobs at all: what a job does here, on the desk with the swipe, and the way to post one.
export function NoJobsYet() {
	return (
		<section aria-label="No jobs yet" className="desk rounded-2xl px-4 py-[clamp(24px,5vw,56px)]">
			<EmptyState
				title="No jobs yet"
				swipe
				illustration={
					<div className="flex h-[132px] w-[176px] flex-col gap-2.5 rounded-sheet bg-sheet p-4 shadow-sheet">
						<i className="h-2.5 w-3/5 rounded-[4px] bg-ink" />
						<i className="h-2 w-2/5 rounded-[4px] bg-line" />
						<i className="mt-2 h-2 w-full rounded-[4px] bg-line-2" />
						<i className="h-2 w-11/12 rounded-[4px] bg-line-2" />
						<i className="h-2 w-4/5 rounded-[4px] bg-line-2" />
					</div>
				}
				actions={
					<Link to="/dashboard/jobs/new" className="btn">
						<Plus size={20} aria-hidden="true" />
						Post your first job
					</Link>
				}
			>
				When you post a job, every CV it gets is read in full, scored against your requirements and ranked here, with
				the evidence beside each score.
			</EmptyState>
		</section>
	);
}

// What a status tab says when it has nothing, with no search typed: why it's empty, not "No jobs match".
const EMPTY_STATUS: Record<JobStatus, { title: string; body: string }> = {
	open: { title: "No open jobs", body: "Open a draft, or post a job, to start taking CVs." },
	draft: { title: "No drafts", body: "A job you save as a draft waits here until you open it." },
	closed: { title: "No closed jobs", body: "A job you close stops taking CVs and moves here. You can reopen it." },
};

// The filters matched nothing, which is not the same as having no jobs.
export function NoJobsMatch({ filters, onClear }: { filters: JobFilters; onClear: () => void }) {
	const byStatus = !filters.q && filters.status ? EMPTY_STATUS[filters.status] : null;
	const title = byStatus?.title ?? "No jobs match";
	return (
		<section aria-label={title} className="rounded-xl bg-sheet shadow-card">
			<EmptyState
				title={title}
				actions={
					<>
						<button type="button" className="btn ghost" onClick={onClear}>
							{byStatus ? "Show all jobs" : "Clear filters"}
						</button>
						{filters.status === "open" && !filters.q && (
							<Link to="/dashboard/jobs/new" className="btn">
								<Plus size={20} aria-hidden="true" />
								Post a job
							</Link>
						)}
					</>
				}
			>
				{byStatus?.body ??
					(filters.q
						? `No job title or description has “${filters.q}”${filters.status ? " with that status" : ""}. Try other words, or clear the filters to see every job.`
						: "Nothing fits those filters. Clear them to see every job.")}
			</EmptyState>
		</section>
	);
}

// The list's shape while the first page loads: the header row and a few rows of grey bars.
export function ListSkeleton() {
	return (
		<div className="mt-2">
			<Skeleton label="Loading your jobs" className="h-11 w-full max-w-[420px]" />
			<div aria-hidden="true" className="mt-8 rounded-xl bg-sheet shadow-card">
				{[0, 1, 2, 3].map((row) => (
					<div key={row} className="flex items-center gap-6 border-b border-line-2 px-5 py-5 last:border-b-0">
						<div className="flex min-w-0 flex-1 flex-col gap-2.5">
							<Skeleton className="h-4 w-[min(260px,70%)]" />
							<Skeleton className="h-3 w-[min(180px,50%)]" />
						</div>
						<div className="hidden w-[220px] flex-col gap-2.5 sm:flex">
							<Skeleton className="h-2.5 w-full" />
							<Skeleton className="h-3 w-3/4" />
						</div>
						<Skeleton className="hidden h-7 w-16 md:block" />
					</div>
				))}
			</div>
		</div>
	);
}

// The first load failed. The page already has its h1, so this is an h2.
export function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
			<h2 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				<span className="mk mk-gap">✕ We couldn't load your jobs</span>
			</h2>
			<p className="text-[15px] text-ink-2">{message}</p>
			<button type="button" className="btn" onClick={onRetry}>
				Try again
			</button>
		</div>
	);
}
