import { Link, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Check, NoteMark } from "../components/icons.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
import { useOrg } from "../dashboard/org.ts";
import { SectionError, SectionLoading } from "../jobs/job-ui.tsx";
import {
	type CandidateSummary,
	CV_LIMIT_PER_JOB,
	DECISION_LABEL,
	type Decision,
	SLOW_CHECK_MS,
	candidateName,
	failureMessage,
	isSlow,
	isWorking,
	useCandidates,
	useDeleteCandidate,
	useRetryCandidate,
	useUploadCvs,
} from "../lib/candidates.ts";
import {
	DEFAULT_VIEW,
	type ListView,
	SORTS,
	STATUS_FILTERS,
	type SortKey,
	type StatusFilter,
	isFiltered,
	visibleCandidates,
} from "../lib/candidate-list.ts";
import type { Job } from "../lib/jobs.ts";
import { useNow } from "../lib/use-now.ts";
import { CandidateTags, DecisionTag } from "./candidate-tags.tsx";
import { ExportMenu } from "./export-menu.tsx";
import { OpenCvButton } from "./open-cv-button.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";
import { ROW_ACTION } from "./row-action.ts";
import { type Segment, SegmentedControl } from "./segmented-control.tsx";
import { UploadZone } from "./upload-zone.tsx";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Set by the candidate page after a delete, for the confirmation on the job page.
		deletedCandidate?: string;
	}
}

// Why a job that isn't open can't take CVs, and what to do about it.
const CLOSED_NOTE = {
	draft: "This job is a draft, so it can't take CVs yet. Open it to start uploading.",
	closed: "This job is closed, so it can't take new CVs. Reopen it to upload more.",
} as const;

// The job page's Candidates section: the upload zone, then everyone uploaded so far, best match first.
export function CandidatesSection({ job }: { job: Job }) {
	const candidates = useCandidates(job.id);
	const uploads = useUploadCvs(job.id);
	const deletedCandidate = useRouterState({ select: (state) => state.location.state.deletedCandidate });
	// Set when a row is deleted here; the candidate page reports its own delete through the router state.
	const [deletedHere, setDeletedHere] = useState<string>();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const list = candidates.data?.candidates ?? [];
	// "All CVs processed" says so when the last CV that was being read in this visit has finished. A list that was
	// never working (opened with everything read already) says nothing.
	const working = list.some(isWorking);
	const [sawWork, setSawWork] = useState(false);
	if (working && !sawWork) setSawWork(true);
	const allProcessed = sawWork && !working && list.length > 0;
	// The job's own count shows until the list arrives.
	const used = candidates.data?.cvCount ?? job.cvCount;
	const limit = candidates.data?.cvLimit ?? CV_LIMIT_PER_JOB;
	const slotsLeft = Math.max(0, limit - used);
	// Why the job can't take CVs right now, if it can't.
	const note =
		job.status !== "open"
			? CLOSED_NOTE[job.status]
			: slotsLeft === 0
				? `This job has used its ${limit} free CVs.`
				: null;

	return (
		<section aria-labelledby="candidates-h" className="mt-10">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
				<h2
					ref={headingRef}
					tabIndex={-1}
					id="candidates-h"
					className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] focus:outline-none [font-stretch:108%]"
				>
					Candidates
				</h2>
				<div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12.5px] text-ink-muted">
					<p>
						{used} of {limit} free CVs used
					</p>
					<ReadProgress list={list} />
				</div>
			</div>
			{/* Always on the page, so the screen reader hears the line when it appears. */}
			<p aria-live="polite" className="mt-2 inline-flex items-center gap-2 font-mono text-[12.5px] text-ink empty:hidden">
				{allProcessed && (
					<>
						<Check />
						All CVs processed. The list is up to date.
					</>
				)}
			</p>

			<AnnouncedBanner message={deletedHere ?? (deletedCandidate && `Deleted “${deletedCandidate}”`)} className="mt-4" />

			<div className="mt-4">
				<UploadZone uploads={uploads} note={note} slotsLeft={slotsLeft} />
			</div>

			<div className="mt-5">
				{candidates.isPending ? (
					<SectionLoading label="Loading candidates" />
				) : candidates.isError && !candidates.data ? (
					<SectionError
						title="We couldn't load the candidates"
						message={candidates.error.message}
						action={
							<button type="button" className="btn" onClick={() => void candidates.refetch()}>
								Try again
							</button>
						}
					/>
				) : (
					<>
						{/* A failed refresh keeps what we have on screen. */}
						{candidates.isError && (
							<RefreshFailed polling={list.some(isWorking)} onRetry={() => void candidates.refetch()} />
						)}
						{list.length > 0 ? (
							<RankedList
								jobId={job.id}
								candidates={list}
								onDeleted={(name) => {
									setDeletedHere(`Deleted “${name}”`);
									// The row that had focus is gone.
									headingRef.current?.focus();
								}}
							/>
						) : (
							<p className="rounded-xl bg-sheet px-6 py-5 text-[15px] text-ink-2 shadow-card">
								No candidates yet. Uploaded CVs are ranked here.
							</p>
						)}
					</>
				)}
			</div>
		</section>
	);
}

// "3 of 5 read", live while CVs are still being read. It's a status region, so screen readers hear
// each change as the scores come in.
function ReadProgress({ list }: { list: CandidateSummary[] }) {
	const working = list.some(isWorking);
	const read = list.filter(({ status }) => status === "scored").length;
	const failed = list.filter(({ status }) => status === "failed").length;
	return (
		<p role="status" className="inline-flex items-center gap-2 text-ink empty:hidden">
			{working && <span className="live-dot" aria-hidden="true" />}
			{list.length > 0 && `${read} of ${list.length} read${failed > 0 ? ` · ${failed} failed` : ""}`}
		</p>
	);
}

type Show = "all" | Decision;

const SHOW_ORDER: Show[] = ["all", "shortlisted", "undecided", "rejected"];
const EMPTY_FILTER: Record<Decision, string> = {
	shortlisted: "No shortlisted candidates yet.",
	undecided: "No undecided candidates yet.",
	rejected: "No rejected candidates yet.",
};
// Rows drawn at first, and added by each "Show 50 more".
const PAGE_SIZE = 50;

function RankedList({
	jobId,
	candidates,
	onDeleted,
}: {
	jobId: string;
	candidates: CandidateSummary[];
	onDeleted: (name: string) => void;
}) {
	const [view, setView] = useState<ListView>(DEFAULT_VIEW);
	const [limit, setLimit] = useState(PAGE_SIZE);
	// A rank belongs to the CV (the API sends it), not to its place on screen: searching and filtering hide rows
	// and never renumber the rest.
	const change = (patch: Partial<ListView>) => {
		setView((current) => ({ ...current, ...patch }));
		setLimit(PAGE_SIZE);
	};
	// The decision filter appears once there is something to decide on.
	const filterable = candidates.some(({ status }) => status === "scored");
	const decision = filterable ? view.decision : "all";
	const rows = visibleCandidates(candidates, { ...view, decision });
	const shown = rows.slice(0, limit);
	const filtered = isFiltered({ ...view, decision });
	const onlyDecision = decision !== "all" && view.query.trim() === "" && view.status === "all";

	return (
		<>
			<div className="mb-4 flex justify-end">
				<ExportMenu jobId={jobId} />
			</div>
			<ListTools view={view} onChange={change} />
			{filterable && <DecisionFilter candidates={candidates} show={view.decision} onChange={(show) => change({ decision: show })} />}
			{filtered && (
				<p aria-live="polite" className="mb-3 font-mono text-[12.5px] text-ink-muted">
					{rows.length === candidates.length
						? `Showing all ${candidates.length} candidates`
						: `Showing ${rows.length} of ${candidates.length} candidates`}
				</p>
			)}
			{rows.length === 0 ? (
				<div className="rounded-xl bg-sheet px-6 py-5 text-[15px] text-ink-2 shadow-card">
					<p>{onlyDecision ? EMPTY_FILTER[decision] : "No candidates match your search and filters."}</p>
					{!onlyDecision && (
						<button type="button" className={`mt-2 ${ROW_ACTION}`} onClick={() => change(DEFAULT_VIEW)}>
							Clear search and filters
						</button>
					)}
				</div>
			) : (
				<ol aria-labelledby="candidates-h" className="rounded-xl bg-sheet px-6 shadow-card">
					{shown.map((candidate) => (
						<CandidateItem key={candidate.id} jobId={jobId} candidate={candidate} onDeleted={onDeleted} />
					))}
				</ol>
			)}
			{rows.length > shown.length && (
				<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
					<button type="button" className="btn ghost" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
						Show {Math.min(PAGE_SIZE, rows.length - shown.length)} more
					</button>
					<p className="font-mono text-[12.5px] text-ink-muted">
						{shown.length} of {rows.length} shown
					</p>
				</div>
			)}
		</>
	);
}

// Search, status and sort. Search and status only hide rows; sort never moves a CV without a score ahead of one with.
function ListTools({ view, onChange }: { view: ListView; onChange: (patch: Partial<ListView>) => void }) {
	return (
		<div className="mb-4 grid gap-3 min-[561px]:grid-cols-[minmax(0,1fr)_auto_auto]">
			<label className="block">
				<span className="mb-1 block font-mono text-[12.5px] text-ink-muted">Search candidates</span>
				<input
					type="search"
					className="field"
					value={view.query}
					placeholder="Name, email or summary"
					autoComplete="off"
					onChange={(event) => onChange({ query: event.target.value })}
				/>
			</label>
			<label className="block">
				<span className="mb-1 block font-mono text-[12.5px] text-ink-muted">Status</span>
				<select
					className="field"
					value={view.status}
					onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
				>
					{STATUS_FILTERS.map(({ value, label }) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</label>
			<label className="block">
				<span className="mb-1 block font-mono text-[12.5px] text-ink-muted">Sort by</span>
				<select className="field" value={view.sort} onChange={(event) => onChange({ sort: event.target.value as SortKey })}>
					{SORTS.map(({ value, label }) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

// "Show: All 5, Shortlisted 2, Undecided 2, Rejected 1". It only hides rows; the counts are of the whole list.
function DecisionFilter({
	candidates,
	show,
	onChange,
}: {
	candidates: CandidateSummary[];
	show: Show;
	onChange: (show: Show) => void;
}) {
	const count = (option: Show) =>
		option === "all" ? candidates.length : candidates.filter(({ decision }) => decision === option).length;
	const segments: Segment<Show>[] = SHOW_ORDER.map((option) => ({
		value: option,
		label: `${option === "all" ? "All" : DECISION_LABEL[option]} ${count(option)}`,
	}));
	return (
		<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
			<span id="show-h" className="font-mono text-[12.5px] text-ink-muted">
				Show
			</span>
			<SegmentedControl name="show" labelledBy="show-h" value={show} segments={segments} onChange={onChange} compact />
		</div>
	);
}

// A row with its tags, its actions and, when the API allows it, a Retry button. Each row keeps its own retry
// state and whether all its requirements are open.
function CandidateItem({
	jobId,
	candidate,
	onDeleted,
}: {
	jobId: string;
	candidate: CandidateSummary;
	onDeleted: (name: string) => void;
}) {
	const org = useOrg();
	const retry = useRetryCandidate(jobId);
	const [expanded, setExpanded] = useState(false);
	const retryLabel = retry.isPending ? "Retrying" : "Retry";
	const name = candidateName(candidate);
	const hidden = candidate.checks.length - candidate.matches.length - candidate.gaps.length;
	// Open: every requirement, the met ones first. Closed: the four best matches and the two worst gaps.
	const matches = expanded ? candidate.checks.filter(({ met }) => met).map(({ label }) => label) : candidate.matches;
	const gaps = expanded ? candidate.checks.filter(({ met }) => !met).map(({ label }) => label) : candidate.gaps;
	return (
		<li className="border-b border-line-2 py-1 last:border-b-0">
			<CandidateRow jobId={jobId} candidate={candidate} />
			<CandidateTags
				matches={matches}
				gaps={gaps}
				className={`mt-1 mb-1 ml-[42px] ${candidate.decision === "rejected" ? "opacity-75" : ""}`}
			/>
			<div className="mb-2 ml-[42px] flex flex-wrap items-center gap-x-4 gap-y-0">
				{(hidden > 0 || expanded) && (
					<button
						type="button"
						className={ROW_ACTION}
						aria-expanded={expanded}
						aria-label={`${expanded ? "Show fewer requirements" : "Show all requirements"} for ${name}`}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? "Show fewer requirements" : "Show all requirements"}
					</button>
				)}
				<OpenCvButton jobId={jobId} candidateId={candidate.id} fileName={candidate.fileName} forName={name} />
				{org.role === "admin" && <DeleteCandidate jobId={jobId} candidate={candidate} onDeleted={onDeleted} />}
				{candidate.canRetry && (
					/* Only looks disabled while it retries, so it keeps keyboard focus; the click is ignored. */
					<button
						type="button"
						className="btn ghost"
						aria-label={`${retryLabel} ${name}`}
						aria-disabled={retry.isPending}
						onClick={() => {
							if (!retry.isPending) retry.mutate(candidate.id);
						}}
					>
						{retryLabel}
					</button>
				)}
			</div>
			{retry.isError && (
				<p role="alert" className="mb-3 ml-[42px] text-[14px] text-gap-ink">
					✕ {retry.error.message}
				</p>
			)}
		</li>
	);
}

// Delete from the row, for admins, behind the same confirmation as on the candidate page. The row goes with the
// CV, so the parent says what was deleted.
function DeleteCandidate({
	jobId,
	candidate,
	onDeleted,
}: {
	jobId: string;
	candidate: CandidateSummary;
	onDeleted: (name: string) => void;
}) {
	const org = useOrg();
	const remove = useDeleteCandidate(jobId, candidate.id);
	const [confirming, setConfirming] = useState(false);
	const name = candidateName(candidate);
	return (
		<>
			<button
				type="button"
				className={`${ROW_ACTION} text-gap-ink`}
				aria-label={`Delete candidate ${name}`}
				onClick={() => setConfirming(true)}
			>
				Delete candidate
			</button>
			{confirming && (
				<ConfirmDialog
					heading={`Delete “${name}”?`}
					confirmLabel="Delete candidate"
					busyLabel="Deleting"
					busy={remove.isPending}
					error={remove.isError ? remove.error.message : null}
					onCancel={() => {
						remove.reset();
						setConfirming(false);
					}}
					onConfirm={() =>
						// The row is gone once this lands, so the parent is told here, not by a callback on the mutation.
						void remove
							.mutateAsync()
							.then(() => onDeleted(name))
							.catch(() => {})
					}
				>
					It's removed for everyone at {org.name}, with the CV file. You can't undo this.
				</ConfirmDialog>
			)}
		</>
	);
}

// One candidate: rank, name and headline, score. The best match sits on the marker stroke with its score
// ringed (design system §3). A CV still being read, or one that failed, says so where the headline would be.
function CandidateRow({ jobId, candidate }: { jobId: string; candidate: CandidateSummary }) {
	const { rank } = candidate;
	const top = rank === 1;
	// Rejected: the name and score go grey, which stays above 4.5:1 on the sheet and on the marker stroke.
	const rejected = candidate.decision === "rejected";
	return (
		<Link
			to="/dashboard/jobs/$jobId/candidates/$candidateId"
			params={{ jobId, candidateId: candidate.id }}
			className={`group -mx-3.5 grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3.5 rounded-md px-3.5 ${top ? "rank-band py-4" : "py-3 hover:bg-paper-2"}`}
		>
			<span className={`font-mono text-[12px] ${top ? "" : "text-ink-faint"}`} aria-hidden="true">
				{rank ?? "–"}
			</span>
			<span className="min-w-0">
				<span
					className={`block font-[800] [overflow-wrap:anywhere] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em] ${top ? "text-[24px] leading-[1.05] tracking-[-0.02em]" : "text-[17px] leading-[1.2] tracking-[-0.01em]"} ${rejected ? "text-ink-muted" : ""}`}
				>
					{rank !== null && <span className="sr-only">Rank {rank}: </span>}
					{candidateName(candidate)}
					{candidate.hasNote && (
						<span className="ml-2 inline-flex translate-y-0.5 text-ink-muted">
							<NoteMark />
							<span className="sr-only">Has a note</span>
						</span>
					)}
				</span>
				<Detail candidate={candidate} top={top} />
				{candidate.decision !== "undecided" && <DecisionTag decision={candidate.decision} className="mt-2" />}
			</span>
			{candidate.status === "scored" && candidate.score !== null && (
				<span className={`${top ? "mr-3" : ""} ${rejected ? "text-ink-muted" : ""}`}>
					<span className="sr-only">Score </span>
					{top ? (
						<ScoreRing score={candidate.score} className="text-[64px]" />
					) : (
						<span className="font-display text-[30px] leading-none font-[800] tabular-nums [font-stretch:62%]">
							{candidate.score}
						</span>
					)}
				</span>
			)}
		</Link>
	);
}

// The line under the name: the headline once scored, otherwise what is happening to the CV. On the marker
// stroke the text is on-marker, as it is on every mark.
function Detail({ candidate, top }: { candidate: CandidateSummary; top: boolean }) {
	const line = `mt-1 block font-mono text-[12px] leading-[1.3] [overflow-wrap:anywhere] ${top ? "text-on-marker" : "text-ink-muted"}`;
	if (isWorking(candidate)) return <Reading candidate={candidate} line={line} />;
	if (candidate.status === "failed") {
		return (
			<span className="mt-1 block font-mono text-[12px] leading-[1.3] text-gap-ink [overflow-wrap:anywhere]">
				✕ {failureMessage(candidate)}
			</span>
		);
	}
	return <span className={line}>{candidate.headline || candidate.fileName}</span>;
}

// Only mounted while the CV is being read, so the clock that decides "taking longer than usual" ticks only then.
function Reading({ candidate, line }: { candidate: CandidateSummary; line: string }) {
	const now = useNow(SLOW_CHECK_MS);
	return (
		<>
			<span className={`${line} flex items-center gap-2`}>
				<span className="live-dot" aria-hidden="true" />
				Reading the CV
			</span>
			{isSlow(candidate, now) && <span className={line}>This is taking longer than usual.</span>}
		</>
	);
}
