import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatNumber } from "../lib/format.ts";
import { type JobFilters, type JobListItem, useJobs } from "../lib/jobs.ts";
import { useOverviewAttention } from "../lib/overview.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PageHeader } from "../ui/page-header.tsx";
import { useToast } from "../ui/use-toast.ts";
import { JobList } from "./list/job-list.tsx";
import { JobsToolbar } from "./list/jobs-toolbar.tsx";
import { ListError, ListSkeleton, NoJobsMatch, NoJobsYet } from "./list/list-states.tsx";
import { statusSummary } from "./list/summaries.ts";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Set by the job page after a delete, for the confirmation on the list.
		deletedJob?: string;
	}
}

// While a CV on the page is being read, the list asks again this often, so the pipelines and live dots stay true.
const READING_POLL_MS = 10_000;

export function JobsPage() {
	useDocumentTitle("Jobs · LucidHire");
	const filters: JobFilters = useSearch({ from: "/dashboard/jobs/" });
	const navigate = useNavigate({ from: "/dashboard/jobs/" });
	const toast = useToast();
	const jobs = useJobs(filters);
	// Counts follow the search, so a searched list asks for the whole company's once more for the summary (usually cached).
	const everything = useJobs({}, { enabled: Boolean(filters.q) });
	const attention = useOverviewAttention();
	const deletedFromJobPage = useRouterState({ select: (state) => state.location.state.deletedJob });
	const contentRef = useRef<HTMLDivElement>(null);
	// The row a delete from the list removed, and where it was, so focus can go to the row that took its place.
	const deleted = useRef<{ id: string; index: number } | null>(null);
	const filtered = Boolean(filters.q || filters.status);
	const empty = jobs.data?.total === 0 && !filtered;
	const anyReading = jobs.data?.jobs.some((job) => job.readingCount > 0) ?? false;

	// A page past the end (the last job on it was deleted, or an old link) goes back to the first.
	useEffect(() => {
		if (jobs.data && !jobs.isPlaceholderData && jobs.data.jobs.length === 0 && jobs.data.total > 0 && filters.page) {
			void navigate({ search: (prev) => ({ ...prev, page: undefined }), replace: true });
		}
	}, [jobs.data, jobs.isPlaceholderData, filters.page, navigate]);

	// A job deleted from its own page is confirmed here, once: the address's state is cleared so Back doesn't repeat it.
	const announced = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!deletedFromJobPage || announced.current === deletedFromJobPage) return;
		announced.current = deletedFromJobPage;
		toast.show(`Deleted “${deletedFromJobPage}”`);
		void navigate({ search: (prev) => prev, state: (prev) => ({ ...prev, deletedJob: undefined }), replace: true });
	}, [deletedFromJobPage, navigate, toast]);

	const { refetch } = jobs;
	useEffect(() => {
		if (!anyReading) return;
		const timer = setInterval(() => void refetch(), READING_POLL_MS);
		return () => clearInterval(timer);
	}, [anyReading, refetch]);

	// Once the deleted row has left the list, focus moves to the row now in its place (or the one before it), or to the
	// page's first control when the list is gone.
	useEffect(() => {
		const gone = deleted.current;
		if (!gone || !jobs.data || jobs.data.jobs.some((job) => job.id === gone.id)) return;
		deleted.current = null;
		const root = contentRef.current;
		const links = [...(root?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
		const target = links[Math.min(gone.index, links.length - 1)] ?? root?.querySelector<HTMLElement>("a[href],button");
		target?.focus();
	}, [jobs.data]);

	const onDeleted = (job: JobListItem) => {
		toast.show(`Deleted “${job.title}”`);
		deleted.current = { id: job.id, index: Math.max(0, jobs.data?.jobs.findIndex((row) => row.id === job.id) ?? 0) };
	};

	const counts = (filters.q ? everything.data?.counts : jobs.data?.counts) ?? null;
	const toReview = attention.data?.totals.toReview ?? 0;
	const summary = counts && statusSummary(counts);

	return (
		<div className="wrap page">
			<PageHeader
				title="Jobs"
				summary={
					summary && (
						<>
							{summary}
							{toReview > 0 && ` · ${formatNumber(toReview)} to review`}
						</>
					)
				}
				actions={
					jobs.data && !empty ? (
						<Link to="/dashboard/jobs/new" className="btn">
							<Plus size={20} aria-hidden="true" />
							Post a job
						</Link>
					) : null
				}
			/>
			<div ref={contentRef} className="mt-6">
				{jobs.isPending ? (
					<ListSkeleton />
				) : jobs.isError && !jobs.data ? (
					<ListError message={jobs.error.message} onRetry={() => void jobs.refetch()} />
				) : empty ? (
					<NoJobsYet />
				) : (
					<>
						<JobsToolbar filters={filters} counts={jobs.data.counts} />
						<p className="sr-only" role="status">
							{formatNumber(jobs.data.total)} {jobs.data.total === 1 ? "job" : "jobs"} found
						</p>
						{jobs.isError && (
							<p role="alert" className="mt-4 text-[14px] text-gap-ink">
								✕ {jobs.error.message}{" "}
								<button type="button" className="underline underline-offset-[.18em]" onClick={() => void jobs.refetch()}>
									Try again
								</button>
							</p>
						)}
						<div
							aria-busy={jobs.isPlaceholderData}
							className={`mt-5 transition-opacity ${jobs.isPlaceholderData ? "opacity-60" : ""}`}
						>
							{jobs.data.total === 0 ? (
								<NoJobsMatch filters={filters} onClear={() => void navigate({ search: {} })} />
							) : (
								<JobList list={jobs.data} filters={filters} onDeleted={onDeleted} />
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
