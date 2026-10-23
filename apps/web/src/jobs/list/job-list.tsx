import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { formatDate, formatNumber, formatRelative } from "../../lib/format.ts";
import type { JobFilters, JobList as JobListData, JobListItem } from "../../lib/jobs.ts";
import { useNow } from "../../lib/use-now.ts";
import { AppLink } from "../../ui/app-link.tsx";
import { StatusTag } from "../../ui/status-tag.tsx";
import { RowActions } from "../row-actions.tsx";
import { Pipeline } from "./pipeline.tsx";
import { firstName } from "./summaries.ts";
import { useJobsHref } from "./use-jobs-href.ts";

// The list sizes itself to its own width, not the window's, since the sidebar can be open, a rail or gone. Below
// 640px each job is a card; from 640px a table-like grid of role, pipeline, top match and actions; from 940px status
// and the last CV get columns of their own (below that they sit under the title).
const GRID =
	"@min-[640px]:grid-cols-[minmax(0,1fr)_minmax(160px,220px)_96px_44px] @min-[640px]:gap-x-4 @min-[640px]:[grid-template-areas:'role_pipe_top_actions'] @min-[940px]:grid-cols-[minmax(0,1fr)_104px_minmax(200px,260px)_120px_100px_44px] @min-[940px]:gap-x-5 @min-[940px]:[grid-template-areas:'role_status_pipe_top_last_actions']";
const CARD_GRID = "grid-cols-[minmax(0,1fr)_auto_44px] [grid-template-areas:'role_role_actions'_'pipe_top_top']";
// A card with nothing scored gives its pipeline the whole width.
const CARD_GRID_UNSCORED = "grid-cols-[minmax(0,1fr)_auto_44px] [grid-template-areas:'role_role_actions'_'pipe_pipe_pipe']";
const HEAD = "font-mono text-[11.5px] leading-[1.3] tracking-[.08em] text-ink-muted uppercase";

export function JobList({
	list,
	filters,
	onDeleted,
}: {
	list: JobListData;
	filters: JobFilters;
	onDeleted: (job: JobListItem) => void;
}) {
	const { jobs, total, page, pageSize } = list;
	const now = useNow(60_000);
	const first = (page - 1) * pageSize + 1;
	const last = first + jobs.length - 1;
	const pages = Math.max(1, Math.ceil(total / pageSize));

	return (
		<section aria-labelledby="jobs-list-h" className="@container">
			<h2 id="jobs-list-h" className="sr-only">
				Your jobs
			</h2>
			<p className="mb-2.5 font-mono text-[12.5px] text-ink-muted">
				Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
			</p>
			<div className="@min-[640px]:overflow-hidden @min-[640px]:rounded-xl @min-[640px]:bg-sheet @min-[640px]:shadow-card">
				<div aria-hidden="true" className={`hidden border-b border-line-2 px-5 py-3 @min-[640px]:grid ${GRID} ${HEAD}`}>
					<span className="[grid-area:role]">Role</span>
					<span className="hidden [grid-area:status] @min-[940px]:block">Status</span>
					<span className="[grid-area:pipe]">Pipeline</span>
					<span className="[grid-area:top]">Top match</span>
					<span className="hidden [grid-area:last] @min-[940px]:block">Last CV</span>
				</div>
				<ul className="flex flex-col gap-3 @min-[640px]:gap-0">
					{jobs.map((job) => (
						<JobRow key={job.id} job={job} now={now} onDeleted={onDeleted} />
					))}
				</ul>
			</div>
			{pages > 1 && <Pagination page={page} pages={pages} filters={filters} />}
		</section>
	);
}

// One job. The title is the link, stretched over the whole row so anywhere on it opens the job; the top match and
// the actions menu sit above that layer with links and buttons of their own.
function JobRow({ job, now, onDeleted }: { job: JobListItem; now: number; onDeleted: (job: JobListItem) => void }) {
	const linkRef = useRef<HTMLAnchorElement>(null);
	const lastCv = job.lastCvAt ? formatRelative(job.lastCvAt, now) : null;
	const scored = job.topScore !== null && job.topCandidate !== null;
	const cvs = job.cvCount > 0 ? `${formatNumber(job.cvCount)} ${job.cvCount === 1 ? "CV" : "CVs"}` : null;

	return (
		<li
			className={`group/row relative grid items-center gap-x-4 gap-y-3 rounded-xl bg-sheet p-4 shadow-card transition-colors hover:bg-paper-2 @min-[640px]:rounded-none @min-[640px]:border-b @min-[640px]:border-line-2 @min-[640px]:bg-transparent @min-[640px]:px-5 @min-[640px]:shadow-none @min-[640px]:last:border-b-0 ${scored ? CARD_GRID : CARD_GRID_UNSCORED} ${GRID}`}
		>
			<div className="min-w-0 [grid-area:role]">
				<AppLink
					ref={linkRef}
					href={`/dashboard/jobs/${job.id}`}
					data-row-link=""
					className="block text-[17px] leading-[1.25] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%] group-hover/row:underline group-hover/row:underline-offset-[.18em] after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:-outline-offset-3 focus-visible:after:outline-ink @min-[640px]:after:rounded-none"
				>
					{job.title}
				</AppLink>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
					<StatusTag status={job.status} className="@min-[940px]:hidden" />
					{/* The full line (when it was made, how many CVs) when there's room; in a narrower table just the CVs, and
					    on a card the CVs and when the last one came in. A job without CVs always says when it was made. */}
					<p className="font-mono text-[12px] leading-[1.4] text-ink-muted">
						<span className={cvs ? "hidden @min-[940px]:inline" : undefined}>
							Created {formatDate(job.createdAt)}
							{cvs && ` · ${cvs}`}
						</span>
						{cvs && (
							<span className="@min-[940px]:hidden">
								{cvs}
								{lastCv && <span className="@min-[640px]:hidden"> · Last CV {lastCv}</span>}
							</span>
						)}
					</p>
				</div>
			</div>
			<div className="hidden [grid-area:status] @min-[940px]:block">
				<StatusTag status={job.status} />
			</div>
			<div className="min-w-0 [grid-area:pipe]">
				<Pipeline job={job} onActivate={() => linkRef.current?.click()} />
			</div>
			{/* A card with nothing scored leaves it out: its pipeline already says so. */}
			<div className={`min-w-0 justify-self-end [grid-area:top] @min-[640px]:block @min-[640px]:justify-self-stretch ${scored ? "" : "hidden"}`}>
				<TopMatch job={job} />
			</div>
			<p className="hidden font-mono text-[12.5px] text-ink-2 [grid-area:last] @min-[940px]:block">
				<span className="sr-only">Last CV </span>
				{lastCv ?? (
					<>
						<span aria-hidden="true" className="text-ink-muted">
							–
						</span>
						<span className="sr-only">none yet</span>
					</>
				)}
			</p>
			<div className="self-start justify-self-end [grid-area:actions] @min-[640px]:self-center">
				<RowActions job={job} onDeleted={onDeleted} />
			</div>
		</li>
	);
}

// The job's best scored CV: its score in condensed numerals and the first name, linking to the candidate.
function TopMatch({ job }: { job: JobListItem }) {
	if (job.topScore === null || !job.topCandidate) {
		return (
			<span className="font-mono text-[12.5px] text-ink-muted">
				<span aria-hidden="true">–</span>
				<span className="sr-only">No scored CVs yet</span>
			</span>
		);
	}
	const name = job.topCandidate.name?.trim() || "Unnamed CV";
	return (
		<AppLink
			href={`/dashboard/jobs/${job.id}/candidates/${job.topCandidate.id}`}
			aria-label={`Top match ${job.topScore}, ${name}`}
			className="group/top relative z-10 -my-1.5 inline-flex max-w-full min-h-11 items-center gap-2 rounded-md py-1.5"
		>
			<span className="font-display text-[30px] leading-none font-[800] tracking-[-0.02em] tabular-nums [font-stretch:62%]">
				{job.topScore}
			</span>
			<span className="min-w-0 truncate text-[14px] text-ink-2 group-hover/top:text-ink group-hover/top:underline group-hover/top:underline-offset-[.18em]">
				{firstName(job.topCandidate.name)}
			</span>
		</AppLink>
	);
}

function Pagination({ page, pages, filters }: { page: number; pages: number; filters: JobFilters }) {
	const href = useJobsHref();
	const to = (target: number) => href({ ...filters, page: target > 1 ? target : undefined });
	const look = "btn ghost xs";
	return (
		<nav aria-label="Pagination" className="mt-5 flex flex-wrap items-center justify-between gap-4">
			{page > 1 ? (
				<AppLink href={to(page - 1)} className={look}>
					<ChevronLeft size={16} aria-hidden="true" />
					Previous
				</AppLink>
			) : (
				<span className={look} aria-disabled="true">
					<ChevronLeft size={16} aria-hidden="true" />
					Previous
				</span>
			)}
			<p className="font-mono text-[13px] text-ink-muted">
				Page {formatNumber(page)} of {formatNumber(pages)}
			</p>
			{page < pages ? (
				<AppLink href={to(page + 1)} className={look}>
					Next
					<ChevronRight size={16} aria-hidden="true" />
				</AppLink>
			) : (
				<span className={look} aria-disabled="true">
					Next
					<ChevronRight size={16} aria-hidden="true" />
				</span>
			)}
		</nav>
	);
}
