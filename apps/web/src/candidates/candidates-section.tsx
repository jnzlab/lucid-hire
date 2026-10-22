import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
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
	useRetryCandidate,
	useUploadCvs,
} from "../lib/candidates.ts";
import type { Job } from "../lib/jobs.ts";
import { useNow } from "../lib/use-now.ts";
import { CandidateTags, DecisionTag } from "./candidate-tags.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";
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
	const list = candidates.data?.candidates ?? [];
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
				<h2 id="candidates-h" className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Candidates
				</h2>
				<div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12.5px] text-ink-muted">
					<p>
						{used} of {limit} free CVs used
					</p>
					<ReadProgress list={list} />
				</div>
			</div>

			<AnnouncedBanner message={deletedCandidate && `Deleted “${deletedCandidate}”`} className="mt-4" />

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
							<RankedList jobId={job.id} candidates={list} />
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

function RankedList({ jobId, candidates }: { jobId: string; candidates: CandidateSummary[] }) {
	const [show, setShow] = useState<Show>("all");
	// Only a CV that has been scored has a rank. The API already sends them best first. A rank belongs to the
	// CV, not to its place on screen: filtering hides rows and never renumbers the rest.
	const ranks = new Map(
		candidates
			.filter(({ status, score }) => status === "scored" && score !== null)
			.map(({ id }, index) => [id, index + 1]),
	);
	// The filter appears once there is something to decide on.
	const filterable = candidates.some(({ status }) => status === "scored");
	const shown = filterable && show !== "all" ? candidates.filter(({ decision }) => decision === show) : candidates;

	return (
		<>
			{filterable && <DecisionFilter candidates={candidates} show={show} onChange={setShow} />}
			{shown.length === 0 && show !== "all" ? (
				<p className="rounded-xl bg-sheet px-6 py-5 text-[15px] text-ink-2 shadow-card">{EMPTY_FILTER[show]}</p>
			) : (
				<ol aria-labelledby="candidates-h" className="rounded-xl bg-sheet px-6 shadow-card">
					{shown.map((candidate) => (
						<CandidateItem key={candidate.id} jobId={jobId} candidate={candidate} rank={ranks.get(candidate.id)} />
					))}
				</ol>
			)}
		</>
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

// A row with its tags and, when the API allows it, a Retry button. Each row keeps its own retry state.
function CandidateItem({
	jobId,
	candidate,
	rank,
}: {
	jobId: string;
	candidate: CandidateSummary;
	rank: number | undefined;
}) {
	const retry = useRetryCandidate(jobId);
	const retryLabel = retry.isPending ? "Retrying" : "Retry";
	return (
		<li className="border-b border-line-2 py-1 last:border-b-0">
			<CandidateRow jobId={jobId} candidate={candidate} rank={rank} />
			<CandidateTags
				matches={candidate.matches}
				gaps={candidate.gaps}
				className={`mt-1 mb-3 ml-[42px] ${candidate.decision === "rejected" ? "opacity-75" : ""}`}
			/>
			{candidate.canRetry && (
				<div className="mb-3 ml-[42px]">
					{/* Only looks disabled while it retries, so it keeps keyboard focus; the click is ignored. */}
					<button
						type="button"
						className="btn ghost"
						aria-label={`${retryLabel} ${candidateName(candidate)}`}
						aria-disabled={retry.isPending}
						onClick={() => {
							if (!retry.isPending) retry.mutate(candidate.id);
						}}
					>
						{retryLabel}
					</button>
				</div>
			)}
			{retry.isError && (
				<p role="alert" className="mb-3 ml-[42px] text-[14px] text-gap-ink">
					✕ {retry.error.message}
				</p>
			)}
		</li>
	);
}

// One candidate: rank, name and headline, score. The best match sits on the marker stroke with its score
// ringed (design system §3). A CV still being read, or one that failed, says so where the headline would be.
function CandidateRow({
	jobId,
	candidate,
	rank,
}: {
	jobId: string;
	candidate: CandidateSummary;
	rank: number | undefined;
}) {
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
					{rank !== undefined && <span className="sr-only">Rank {rank}: </span>}
					{candidateName(candidate)}
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
