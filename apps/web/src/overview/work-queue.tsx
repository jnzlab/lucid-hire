import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FilePenLine, FileWarning, Inbox, Link2, Plus, Share2, Upload } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ArrowRight } from "../components/icons.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
import { useOpenJobs } from "../dashboard/shell-data.ts";
import { candidateName } from "../lib/candidates.ts";
import { formatRelative } from "../lib/format.ts";
import type { OverviewAttention } from "../lib/overview.ts";
import { AppLink } from "../ui/app-link.tsx";
import { CountBadge } from "../ui/count-badge.tsx";
import { DecisionTag } from "../ui/decision-tag.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Menu, MenuGroup, MenuItem } from "../ui/menu.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { CARD, CardState, Section } from "./card.tsx";
import { plural } from "./plural.ts";
import { useCopyApplyLink } from "./use-copy-link.tsx";

type Waiting = OverviewAttention["waiting"][number];
type BestNewMatch = OverviewAttention["bestNew"][number];

// Rows "Needs attention" lists before "Show all".
const ATTENTION_SHOWN = 5;
// Open jobs the "Share a job" menu offers.
const SHARE_JOBS_SHOWN = 8;
const ALL_TO_REVIEW_PATH = "/dashboard/candidates?decision=review";

// The job page's candidate filters are search params (`show`). Built as plain hrefs so these links don't depend on the
// job route's search types.
const jobFilterPath = (jobId: string, show: "review" | "failed") => `/dashboard/jobs/${encodeURIComponent(jobId)}?show=${show}`;

const smallButton = "btn ghost xs pointer-coarse:min-h-11";

// The overview's left column, all from one request (GET /overview/attention): what is waiting for a decision, what
// went wrong or is stuck, and the best CVs of the week.
export function WorkQueue({ attention }: { attention: UseQueryResult<OverviewAttention> }) {
	const data = attention.data;
	return (
		<div className="flex min-w-0 flex-col gap-10">
			<Section
				title="Waiting for you"
				badge={data && <CountBadge count={data.totals.toReview} variant="marker" label="to review" />}
				aside={
					data && data.totals.toReview > 0 ? (
						<AppLink
							href={ALL_TO_REVIEW_PATH}
							className="inline-flex min-h-11 items-center gap-1.5 font-mono text-[12.5px] text-ink-2 underline underline-offset-[.18em] hover:text-ink"
						>
							All to review <span aria-hidden="true">→</span>
						</AppLink>
					) : undefined
				}
			>
				<CardState query={attention} what="your work queue" loading={(label) => <QueueSkeleton label={label} />}>
					{(queue) => <WaitingList queue={queue} />}
				</CardState>
			</Section>
			{data && <NeedsAttention queue={data} />}
			{data && <BestNewMatches matches={data.bestNew} />}
		</div>
	);
}

function QueueSkeleton({ label }: { label: string }) {
	return (
		<div role="status" className="flex flex-col gap-4">
			<span className="sr-only">{label}</span>
			{[0, 1].map((index) => (
				<div key={index} className={`${CARD} flex flex-col gap-3 p-5`} aria-hidden="true">
					<Skeleton className="h-5 w-48" />
					<Skeleton className="h-3 w-56" />
					<Skeleton className="mt-3 h-3 w-full" />
					<Skeleton className="h-3 w-4/5" />
					<Skeleton className="h-3 w-3/5" />
				</div>
			))}
		</div>
	);
}

// One card per open job with CVs to review or being read, most to review first. If some CVs to review sit on
// jobs that aren't listed (closed jobs, drafts, or past the first six), a line says how many and where to find them.
function WaitingList({ queue }: { queue: OverviewAttention }) {
	if (queue.waiting.length === 0) return <AllClear queue={queue} />;
	const listed = queue.waiting.reduce((sum, job) => sum + job.toReview, 0);
	const elsewhere = queue.totals.toReview - listed;
	return (
		<>
			<ul className="flex flex-col gap-4">
				{queue.waiting.map((job) => (
					<li key={job.jobId}>
						<WaitingJob job={job} />
					</li>
				))}
			</ul>
			{elsewhere > 0 && (
				<p className="text-[15px] text-ink-2">
					{plural(elsewhere, "more CV is", "more CVs are")} waiting on other jobs.{" "}
					<AppLink href={ALL_TO_REVIEW_PATH} className="font-[650] text-ink underline underline-offset-[.18em]">
						See every CV to review
					</AppLink>
				</p>
			)}
		</>
	);
}

// A job in the queue: its title, where its pipeline stands ("9 to review · 3 shortlisted · 3 reading", with the live
// dot while CVs are being read), its best three CVs to review, and the one thing to do next.
function WaitingJob({ job }: { job: Waiting }) {
	const counts = [
		job.toReview > 0 ? `${job.toReview} to review` : null,
		job.shortlisted > 0 ? `${job.shortlisted} shortlisted` : null,
	].filter((part) => part !== null);
	return (
		<article className={`${CARD} @container p-5 @max-[560px]:p-4`}>
			<div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
				<div className="min-w-0 flex-[1_1_220px]">
					<h3 className="font-display text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%]">
						<Link
							to="/dashboard/jobs/$jobId"
							params={{ jobId: job.jobId }}
							className="underline-offset-[.18em] hover:underline"
						>
							{job.jobTitle}
						</Link>
					</h3>
					<p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] text-ink-muted">
						{counts.join(" · ")}
						{job.reading > 0 && (
							<span className="inline-flex items-center gap-1.5">
								{counts.length > 0 && <span aria-hidden="true">·</span>}
								<span className="live-dot" aria-hidden="true" />
								{job.reading} reading
							</span>
						)}
					</p>
				</div>
				{job.toReview > 0 ? (
					<AppLink href={jobFilterPath(job.jobId, "review")} className="btn flex-none @max-[440px]:w-full">
						Review {job.toReview}{" "}
						<span className="sr-only">{job.toReview === 1 ? "candidate" : "candidates"} for {job.jobTitle}</span>
						<ArrowRight />
					</AppLink>
				) : (
					<Link to="/dashboard/jobs/$jobId" params={{ jobId: job.jobId }} className="btn ghost flex-none @max-[440px]:w-full">
						Open job <span className="sr-only">{job.jobTitle}</span>
					</Link>
				)}
			</div>
			{job.top.length > 0 ? (
				<ol className="mt-3.5 border-t border-line-2 pt-1.5" aria-label={`Best to review for ${job.jobTitle}`}>
					{job.top.map((candidate) => (
						<li key={candidate.candidateId}>
							<Link
								to="/dashboard/jobs/$jobId/candidates/$candidateId"
								params={{ jobId: job.jobId, candidateId: candidate.candidateId }}
								className="group -mx-3 grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-3 py-1.5 hover:bg-paper-2"
							>
								{/* One line where the card is wide enough (name, then the headline cut short), two lines below that. */}
								<span className="min-w-0 @min-[520px]:flex @min-[520px]:items-baseline @min-[520px]:gap-3">
									<span className="block text-[16px] leading-[1.25] font-[800] [overflow-wrap:anywhere] [font-stretch:104%] group-hover:underline group-hover:underline-offset-[.18em] @min-[520px]:max-w-[60%] @min-[520px]:flex-none">
										{candidateName(candidate)}
									</span>
									{candidate.headline && (
										<span className="mt-0.5 block min-w-0 truncate font-mono text-[12px] leading-[1.35] text-ink-muted @min-[520px]:mt-0">
											<span className="sr-only">,</span> {candidate.headline}
										</span>
									)}
								</span>
								<span className="font-display text-[30px] leading-none font-[800] tracking-[-0.02em] tabular-nums [font-stretch:62%]">
									<span className="sr-only">, score</span> {candidate.score}
								</span>
							</Link>
						</li>
					))}
				</ol>
			) : (
				<p className="mt-4 border-t border-line-2 pt-4 text-[15px] text-ink-2">
					<span className="mr-1.5 inline-flex items-center gap-2 font-mono text-[12.5px] text-ink">
						<span className="live-dot" aria-hidden="true" />
						Reading {plural(job.reading, "CV", "CVs")}.
					</span>{" "}
					They show here once they're scored.
				</p>
			)}
		</article>
	);
}

const hasAttention = (queue: OverviewAttention) =>
	queue.failed.length + queue.emptyOpenJobs.length + queue.drafts.length > 0;

// Nothing waits for a decision. With nothing else to do either, it's the all-clear (the screen's one swipe) with the
// ways to bring in more CVs; otherwise a quiet line, because "Needs attention" below holds the next step.
function AllClear({ queue }: { queue: OverviewAttention }) {
	const openJobs = useOpenJobs();
	const shareable = openJobs.data?.jobs ?? [];
	if (hasAttention(queue)) {
		return (
			<div className={CARD}>
				<EmptyState compact headingLevel={3} title="Nothing waiting for a decision">
					New CVs show here as soon as they're read.
				</EmptyState>
			</div>
		);
	}
	return (
		<div className={CARD}>
			<EmptyState
				headingLevel={3}
				swipe
				illustration={<DrawnCheck />}
				title="You're up to date"
				actions={
					<>
						{shareable.length > 0 && <ShareJobMenu jobs={shareable} />}
						<Link to="/dashboard/jobs/new" className={shareable.length > 0 ? "btn ghost" : "btn"}>
							<Plus size={20} aria-hidden="true" />
							Post a job
						</Link>
					</>
				}
			>
				New CVs show here as soon as they're read.
			</EmptyState>
		</div>
	);
}

// The prototype's drawn check, large, for the all-clear.
function DrawnCheck() {
	return (
		<svg viewBox="0 0 16 16" width="56" height="56" className="text-ink" aria-hidden="true">
			<path d="M2.5 8.5 6 12l7.5-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

// "Share a job": the open jobs, each copying its apply link (with a toast).
function ShareJobMenu({ jobs }: { jobs: Array<{ id: string; title: string; slug: string }> }) {
	const copy = useCopyApplyLink();
	return (
		<Menu
			triggerClassName="btn"
			align="center"
			trigger={
				<>
					<Share2 size={18} aria-hidden="true" />
					Share a job
				</>
			}
		>
			<MenuGroup label="Copy the apply link for">
				{jobs.slice(0, SHARE_JOBS_SHOWN).map((job) => (
					<MenuItem key={job.id} icon={<Link2 size={16} aria-hidden="true" />} onSelect={() => void copy(job)}>
						{job.title}
					</MenuItem>
				))}
			</MenuGroup>
			{jobs.length > SHARE_JOBS_SHOWN && <MenuItem href="/dashboard/jobs?status=open">All open jobs</MenuItem>}
		</Menu>
	);
}

type AttentionItem = { key: string; icon: ReactNode; text: ReactNode; meta?: string; actions: ReactNode };

// "Edited 5 min ago", "Edited yesterday", "Edited 2 Oct 2026".
function edited(iso: string) {
	const when = formatRelative(iso);
	return `Edited ${/^(Just now|Yesterday)$/.test(when) ? when.toLowerCase() : when}`;
}

// Things that need a person but aren't decisions: CVs that couldn't be read, open jobs nobody has applied to yet,
// and drafts. One row each, with the action that deals with it. Hidden when there's nothing.
function NeedsAttention({ queue }: { queue: OverviewAttention }) {
	const copy = useCopyApplyLink();
	const [expanded, setExpanded] = useState(false);
	const icon = "grid size-9 place-items-center rounded-lg bg-paper-2";
	const items: AttentionItem[] = [
		...queue.failed.map((job) => ({
			key: `failed-${job.jobId}`,
			icon: (
				<span className={`${icon} text-gap-ink`}>
					<FileWarning size={20} />
				</span>
			),
			text: (
				<>
					{plural(job.count, "CV", "CVs")} couldn't be read for <span className="font-[650]">{job.jobTitle}</span>
				</>
			),
			actions: (
				<AppLink href={jobFilterPath(job.jobId, "failed")} className={smallButton}>
					Review <span className="sr-only">the CVs that couldn't be read for {job.jobTitle}</span>
				</AppLink>
			),
		})),
		...queue.emptyOpenJobs.map((job) => ({
			key: `empty-${job.jobId}`,
			icon: (
				<span className={`${icon} text-ink-muted`}>
					<Inbox size={20} />
				</span>
			),
			text: (
				<>
					<span className="font-[650]">{job.jobTitle}</span> has no CVs yet
				</>
			),
			meta: "Share its apply link, or upload CVs you already have.",
			actions: (
				<>
					<button type="button" className={smallButton} onClick={() => void copy({ title: job.jobTitle, slug: job.slug })}>
						<Link2 size={16} aria-hidden="true" />
						Copy apply link <span className="sr-only">for {job.jobTitle}</span>
					</button>
					<Link to="/dashboard/jobs/$jobId" params={{ jobId: job.jobId }} hash="upload" className={smallButton}>
						<Upload size={16} aria-hidden="true" />
						Upload CVs <span className="sr-only">to {job.jobTitle}</span>
					</Link>
				</>
			),
		})),
		...queue.drafts.map((job) => ({
			key: `draft-${job.jobId}`,
			icon: (
				<span className={`${icon} text-ink-muted`}>
					<FilePenLine size={20} />
				</span>
			),
			text: (
				<>
					<span className="font-[650]">{job.jobTitle}</span> is a draft
				</>
			),
			meta: edited(job.updatedAt),
			actions: (
				<Link to="/dashboard/jobs/$jobId/edit" params={{ jobId: job.jobId }} className={smallButton}>
					Finish and open <span className="sr-only">{job.jobTitle}</span>
				</Link>
			),
		})),
	];
	if (items.length === 0) return null;
	const shown = expanded ? items : items.slice(0, ATTENTION_SHOWN);

	return (
		<Section title="Needs attention" badge={<CountBadge count={items.length} />}>
			<div className={`${CARD} @container px-5 py-1 @max-[560px]:px-4`}>
				<ul className="divide-y divide-line-2">
					{shown.map((item) => (
						<li
							key={item.key}
							className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2.5 py-3.5 @min-[520px]:grid-cols-[36px_minmax(0,1fr)_auto]"
						>
							<span aria-hidden="true">{item.icon}</span>
							<div className="min-w-0">
								<p className="text-[15px] leading-[1.4] [overflow-wrap:anywhere]">{item.text}</p>
								{item.meta && <p className="mt-0.5 font-mono text-[12px] leading-[1.4] text-ink-muted">{item.meta}</p>}
							</div>
							<div className="col-start-2 flex flex-wrap gap-2 @min-[520px]:col-start-3 @min-[520px]:justify-end">
								{item.actions}
							</div>
						</li>
					))}
				</ul>
			</div>
			{items.length > ATTENTION_SHOWN && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((was) => !was)}
					className="inline-flex min-h-11 items-center self-start font-mono text-[12.5px] text-ink-2 underline underline-offset-[.18em] hover:text-ink"
				>
					{expanded ? "Show fewer" : `Show all ${items.length}`}
				</button>
			)}
		</Section>
	);
}

// The job title, then the headline without its first part when that just repeats the title
// ("Customer Success Lead · Amsterdam" for the Customer Success Lead job).
function matchMeta({ jobTitle, headline }: Pick<BestNewMatch, "jobTitle" | "headline">) {
	const parts = (headline ?? "").split(" · ").filter(Boolean);
	if (parts[0]?.trim().toLowerCase() === jobTitle.trim().toLowerCase()) parts.shift();
	return [jobTitle, ...parts].join(" · ");
}

// The best CVs scored this week across every job, best first. The first sits on the marker band with the screen's
// one ink ring (design system §3); each row opens the candidate.
function BestNewMatches({ matches }: { matches: BestNewMatch[] }) {
	return (
		<Section title="Best new matches" aside={<p className="font-mono text-[12.5px] text-ink-muted">Scored in the last 7 days</p>}>
			<div className={`${CARD} px-5 py-2 @max-[560px]:px-4`}>
				{matches.length === 0 ? (
					<p className="py-3 text-[15px] text-ink-2">No CVs were scored in the last 7 days. New ones show here, best first.</p>
				) : (
					<ol>
						{matches.map((match, index) => (
							<BestRow key={match.candidateId} match={match} rank={index + 1} />
						))}
					</ol>
				)}
			</div>
		</Section>
	);
}

function BestRow({ match, rank }: { match: BestNewMatch; rank: number }) {
	const top = rank === 1;
	return (
		<li className={rank > 2 ? "border-t border-line-2" : ""}>
			<Link
				to="/dashboard/jobs/$jobId/candidates/$candidateId"
				params={{ jobId: match.jobId, candidateId: match.candidateId }}
				className={`group -mx-3 grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-3 ${top ? "rank-band my-1.5 py-4" : "min-h-14 py-3 hover:bg-paper-2"}`}
			>
				<span className={`font-mono text-[12px] ${top ? "" : "text-ink-faint"}`} aria-hidden="true">
					{rank}
				</span>
				<span className="min-w-0">
					<span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
						<span
							className={`font-[800] [overflow-wrap:anywhere] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em] ${top ? "text-[22px] leading-[1.05] tracking-[-0.02em]" : "text-[16px] leading-[1.25]"}`}
						>
							<span className="sr-only">Rank {rank}:</span> {candidateName(match)}
						</span>
						{match.decision !== "undecided" && <DecisionTag decision={match.decision} />}
					</span>
					<span
						className={`mt-1 block font-mono text-[12px] leading-[1.35] [overflow-wrap:anywhere] ${top ? "text-on-marker" : "text-ink-muted"}`}
					>
						<span className="sr-only">,</span> {matchMeta(match)}
					</span>
				</span>
				<span className={top ? "mr-2" : ""}>
					<span className="sr-only">, score</span>{" "}
					{top ? (
						<ScoreRing score={match.score} className="text-[52px]" />
					) : (
						<span className="font-display text-[30px] leading-none font-[800] tracking-[-0.02em] tabular-nums [font-stretch:62%]">
							{match.score}
						</span>
					)}
				</span>
			</Link>
		</li>
	);
}
