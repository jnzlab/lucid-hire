import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { Swipe } from "../components/swipe.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type Segment, SegmentedControl } from "../candidates/segmented-control.tsx";
import { formatDate, formatNumber } from "../lib/format.ts";
import {
	JOB_SEARCH_MAX,
	JOB_SORTS,
	type JobFilters,
	type JobList as JobListData,
	type JobListItem,
	type JobSort,
	type JobStatus,
	SORT_LABEL,
	useJobs,
} from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { JobStatusTag, PageHeading, SectionError, SectionLoading } from "./job-ui.tsx";
import { RowActions } from "./row-actions.tsx";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Set by the job page after a delete, for the confirmation on the list.
		deletedJob?: string;
	}
}

const SEARCH_DEBOUNCE_MS = 300;
const STATUS_SEGMENTS: Segment<"all" | JobStatus>[] = [
	{ value: "all", label: "All" },
	{ value: "open", label: "Open" },
	{ value: "draft", label: "Draft" },
	{ value: "closed", label: "Closed" },
];

export function JobsPage() {
	useDocumentTitle("Jobs · LucidHire");
	const org = useOrg();
	const filters: JobFilters = useSearch({ from: "/dashboard/" });
	const navigate = useNavigate({ from: "/dashboard/" });
	const jobs = useJobs(filters);
	const deletedFromJobPage = useRouterState({ select: (state) => state.location.state.deletedJob });
	// A delete from a row's menu is confirmed the same way as one from the job's page.
	const [deletedHere, setDeletedHere] = useState<string>();
	const deletedJob = deletedHere ?? deletedFromJobPage;
	const filtered = Boolean(filters.q || filters.status);
	const empty = jobs.data?.total === 0 && !filtered;

	// A page past the end (the last job on it was deleted, or an old link) goes back to the first.
	useEffect(() => {
		if (jobs.data && !jobs.isPlaceholderData && jobs.data.jobs.length === 0 && jobs.data.total > 0 && filters.page) {
			void navigate({ search: (prev) => ({ ...prev, page: undefined }), replace: true });
		}
	}, [jobs.data, jobs.isPlaceholderData, filters.page, navigate]);

	const newJob = (
		<Link to="/dashboard/jobs/new" className="btn">
			Post a job <ArrowRight />
		</Link>
	);

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<PageHeading eyebrow={org.name} title="Jobs" actions={jobs.data && !empty ? newJob : null} />
			<AnnouncedBanner message={deletedJob && `Deleted “${deletedJob}”`} className="mt-6" />
			<div className="mt-8">
				{jobs.isPending ? (
					<SectionLoading label="Loading your jobs" />
				) : jobs.isError && !jobs.data ? (
					<SectionError
						title="We couldn't load your jobs"
						message={jobs.error.message}
						action={
							<button type="button" className="btn" onClick={() => void jobs.refetch()}>
								Try again
							</button>
						}
					/>
				) : empty ? (
					<NoJobsYet />
				) : (
					<>
						<Toolbar filters={filters} total={jobs.data.total} />
						{jobs.isError && (
							<p role="alert" className="mt-4 text-[14px] text-gap-ink">
								✕ {jobs.error.message}{" "}
								<button type="button" className="underline underline-offset-[.18em]" onClick={() => void jobs.refetch()}>
									Try again
								</button>
							</p>
						)}
						<div aria-busy={jobs.isPlaceholderData} className={`mt-5 ${jobs.isPlaceholderData ? "opacity-60" : ""}`}>
							{jobs.data.total === 0 ? <NoJobsMatch /> : <JobList list={jobs.data} filters={filters} onDeleted={setDeletedHere} />}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// Search, status and sort. They live in the address (`?q=&status=&sort=&page=`), so a filtered list can be
// bookmarked, shared and reached with the back button. Typing waits a moment before it searches.
function Toolbar({ filters, total }: { filters: JobFilters; total: number }) {
	const navigate = useNavigate({ from: "/dashboard/" });
	const statusId = useId();
	const sortId = useId();
	const [text, setText] = useState(filters.q ?? "");
	const sent = useRef(filters.q ?? "");
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const clean = (value: string) => value.trim().replace(/\s+/g, " ");

	// The address changed from outside (back button, Clear filters): the box follows it.
	useEffect(() => {
		const q = filters.q ?? "";
		if (q !== sent.current) {
			sent.current = q;
			setText(q);
		}
	}, [filters.q]);
	useEffect(() => () => clearTimeout(timer.current), []);

	const search = (value: string) => {
		clearTimeout(timer.current);
		const q = clean(value);
		if (q === sent.current) return;
		sent.current = q;
		void navigate({ search: (prev) => ({ ...prev, q: q || undefined, page: undefined }), replace: true });
	};
	const change = (patch: Partial<JobFilters>) =>
		void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });
	const clear = () => {
		clearTimeout(timer.current);
		sent.current = "";
		setText("");
		void navigate({ search: {} });
	};
	const customised = Boolean(filters.q || filters.status || filters.sort);

	return (
		<div role="search" className="flex flex-wrap items-end gap-x-5 gap-y-4">
			<form
				className="min-w-[220px] flex-1"
				onSubmit={(event) => {
					event.preventDefault();
					search(text);
				}}
			>
				<label htmlFor="job-search" className="block text-[14px] font-semibold">
					Search jobs
				</label>
				<input
					id="job-search"
					type="search"
					className="field mt-1.5"
					placeholder="Title or description"
					maxLength={JOB_SEARCH_MAX}
					autoComplete="off"
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => search(event.target.value), SEARCH_DEBOUNCE_MS);
					}}
				/>
			</form>
			<div>
				<p id={statusId} className="text-[14px] font-semibold">
					Status
				</p>
				<SegmentedControl
					name="job-status"
					labelledBy={statusId}
					value={filters.status ?? "all"}
					segments={STATUS_SEGMENTS}
					compact
					className="mt-1.5"
					onChange={(status) => change({ status: status === "all" ? undefined : status })}
				/>
			</div>
			<div>
				<label htmlFor={sortId} className="block text-[14px] font-semibold">
					Sort by
				</label>
				<select
					id={sortId}
					className="field mt-1.5 w-auto pr-8"
					value={filters.sort ?? "newest"}
					onChange={(event) => {
						const sort = event.target.value as JobSort;
						change({ sort: sort === "newest" ? undefined : sort });
					}}
				>
					{JOB_SORTS.map((sort) => (
						<option key={sort} value={sort}>
							{SORT_LABEL[sort]}
						</option>
					))}
				</select>
			</div>
			{customised && (
				<button type="button" className="btn ghost" onClick={clear}>
					Clear filters
				</button>
			)}
			<p className="sr-only" role="status">
				{formatNumber(total)} {total === 1 ? "job" : "jobs"} found
			</p>
		</div>
	);
}

function JobList({
	list,
	filters,
	onDeleted,
}: {
	list: JobListData;
	filters: JobFilters;
	onDeleted: (title: string) => void;
}) {
	const { jobs, total, page, pageSize } = list;
	const first = (page - 1) * pageSize + 1;
	const last = first + jobs.length - 1;
	const pages = Math.max(1, Math.ceil(total / pageSize));

	return (
		<section aria-labelledby="jobs-list-h">
			<h2 id="jobs-list-h" className="sr-only">
				Your jobs
			</h2>
			<p className="mb-3 font-mono text-[12.5px] text-ink-muted">
				Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
			</p>
			<div className="rounded-xl bg-sheet px-6 shadow-card">
				<ul>
					{jobs.map((job) => (
						<JobRow key={job.id} job={job} onDeleted={onDeleted} />
					))}
				</ul>
			</div>
			{pages > 1 && <Pagination page={page} pages={pages} filters={filters} />}
		</section>
	);
}

function Pagination({ page, pages, filters }: { page: number; pages: number; filters: JobFilters }) {
	const to = (target: number) => ({ ...filters, page: target > 1 ? target : undefined });
	return (
		<nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center justify-between gap-4">
			{page > 1 ? (
				<Link to="/dashboard" search={to(page - 1)} className="btn ghost">
					Previous
				</Link>
			) : (
				<span className="btn ghost" aria-disabled="true">
					Previous
				</span>
			)}
			<p className="font-mono text-[13px] text-ink-muted">
				Page {page} of {pages}
			</p>
			{page < pages ? (
				<Link to="/dashboard" search={to(page + 1)} className="btn ghost">
					Next
				</Link>
			) : (
				<span className="btn ghost" aria-disabled="true">
					Next
				</span>
			)}
		</nav>
	);
}

function JobRow({ job, onDeleted }: { job: JobListItem; onDeleted: (title: string) => void }) {
	return (
		<li className="flex items-center gap-2 border-b border-line-2 last:border-b-0">
			<Link
				to="/dashboard/jobs/$jobId"
				params={{ jobId: job.id }}
				className="group -mx-3 my-1.5 flex min-h-16 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md px-3 py-3 hover:bg-paper-2"
			>
				<span className="min-w-0">
					<span className="block text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em]">
						{job.title}
					</span>
					<span className="mt-1 block font-mono text-[12px] text-ink-muted">
						Created {formatDate(job.createdAt)}
						{job.cvCount > 0 && ` · ${job.cvCount} ${job.cvCount === 1 ? "CV" : "CVs"} (${job.scoredCount} scored)`}
					</span>
				</span>
				<JobStatusTag status={job.status} />
			</Link>
			<RowActions job={job} onDeleted={onDeleted} />
		</li>
	);
}

// The filters matched nothing, which is not the same as having no jobs.
function NoJobsMatch() {
	const navigate = useNavigate({ from: "/dashboard/" });
	return (
		<section aria-labelledby="no-match-h" className="rounded-xl bg-sheet px-6 py-10 text-center shadow-card">
			<h2 id="no-match-h" className="text-[22px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:110%]">
				No jobs match
			</h2>
			<p className="mx-auto mt-3 max-w-[46ch] text-[16px] text-ink-2">
				Nothing fits that search and those filters. Try other words, or clear the filters to see every job.
			</p>
			<button type="button" className="btn mt-6" onClick={() => void navigate({ search: {} })}>
				Clear filters
			</button>
		</section>
	);
}

function NoJobsYet() {
	return (
		<section
			aria-labelledby="no-jobs-h"
			className="desk flex flex-col items-center rounded-2xl px-6 py-[clamp(40px,7vw,80px)] text-center"
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
			<Link to="/dashboard/jobs/new" className="btn mt-7">
				Post your first job <ArrowRight />
			</Link>
		</section>
	);
}
