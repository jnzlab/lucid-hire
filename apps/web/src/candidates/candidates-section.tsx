import { Link, useRouterState } from "@tanstack/react-router";
import { ScoreRing } from "../components/score-ring.tsx";
import { SectionError, SectionLoading } from "../jobs/job-ui.tsx";
import {
	type CandidateSummary,
	CV_LIMIT_PER_JOB,
	candidateName,
	isSlow,
	isWorking,
	useCandidates,
	useRetryCandidate,
	useUploadCvs,
} from "../lib/candidates.ts";
import type { Job } from "../lib/jobs.ts";
import { CandidateTags } from "./candidate-tags.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";
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

			{deletedCandidate && (
				<p
					role="status"
					className="mt-4 inline-flex min-h-11 items-center gap-2.5 rounded-md bg-ink px-3.5 font-mono text-[13.5px] text-paper"
				>
					Deleted “{deletedCandidate}”
				</p>
			)}

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
						{list.length > 0 && <RankedList jobId={job.id} candidates={list} />}
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

function RankedList({ jobId, candidates }: { jobId: string; candidates: CandidateSummary[] }) {
	// Only a CV that has been scored has a rank. The API already sends them best first.
	const ranks = new Map(
		candidates
			.filter(({ status, score }) => status === "scored" && score !== null)
			.map(({ id }, index) => [id, index + 1]),
	);

	return (
		<ol aria-labelledby="candidates-h" className="rounded-xl bg-sheet px-6 shadow-card">
			{candidates.map((candidate) => (
				<CandidateItem key={candidate.id} jobId={jobId} candidate={candidate} rank={ranks.get(candidate.id)} />
			))}
		</ol>
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
	return (
		<li className="border-b border-line-2 py-1 last:border-b-0">
			<CandidateRow jobId={jobId} candidate={candidate} rank={rank} />
			<CandidateTags matches={candidate.matches} gaps={candidate.gaps} className="mt-1 mb-3 ml-[42px]" />
			{candidate.canRetry && (
				<div className="mb-3 ml-[42px]">
					<button
						type="button"
						className="btn ghost"
						disabled={retry.isPending}
						onClick={() => retry.mutate(candidate.id)}
					>
						{retry.isPending ? "Retrying" : "Retry"}
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
					className={`block font-[800] [overflow-wrap:anywhere] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em] ${top ? "text-[24px] leading-[1.05] tracking-[-0.02em]" : "text-[17px] leading-[1.2] tracking-[-0.01em]"}`}
				>
					{rank !== undefined && <span className="sr-only">Rank {rank}: </span>}
					{candidateName(candidate)}
				</span>
				<Detail candidate={candidate} top={top} />
			</span>
			{candidate.status === "scored" && candidate.score !== null && (
				<span className={top ? "mr-3" : ""}>
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
	if (isWorking(candidate)) {
		return (
			<>
				<span className={`${line} flex items-center gap-2`}>
					<span className="live-dot" aria-hidden="true" />
					Reading the CV
				</span>
				{isSlow(candidate) && <span className={line}>This is taking longer than usual.</span>}
			</>
		);
	}
	if (candidate.status === "failed") {
		return (
			<span className="mt-1 block font-mono text-[12px] leading-[1.3] text-gap-ink [overflow-wrap:anywhere]">
				✕ {candidate.error ?? "Scoring failed. Try again."}
			</span>
		);
	}
	return <span className={line}>{candidate.headline || candidate.fileName}</span>;
}
