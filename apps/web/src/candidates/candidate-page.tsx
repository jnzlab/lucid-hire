import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DeleteDialog } from "../components/delete-dialog.tsx";
import { Check } from "../components/icons.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
import { useOrg } from "../dashboard/org.ts";
import { BackToJob, PageHeading, SectionError, SectionLoading } from "../jobs/job-ui.tsx";
import { ApiError } from "../lib/api.ts";
import {
	type Candidate,
	CV_LIMIT_PER_JOB,
	MAX_SCORING_RUNS,
	type Requirement,
	candidateName,
	formatFileSize,
	isSlow,
	isWorking,
	useCandidate,
	useDeleteCandidate,
	useRetryCandidate,
} from "../lib/candidates.ts";
import { useJob } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { InterviewQuestions } from "./interview-questions.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";

export function CandidatePage({ jobId, candidateId }: { jobId: string; candidateId: string }) {
	const job = useJob(jobId);
	const remove = useDeleteCandidate(jobId, candidateId);
	// Once the delete starts nothing asks for the candidate again: after the API deletes it, a poll
	// would get "doesn't exist" before we have navigated away.
	const candidate = useCandidate(jobId, candidateId, !remove.isPending && !remove.isSuccess);
	useDocumentTitle(`${candidate.data ? candidateName(candidate.data) : "Candidate"} · LucidHire`);
	// A failed refresh keeps the page, unless the API says the candidate is gone.
	const gone = candidate.error instanceof ApiError && candidate.error.status === 404;

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<BackToJob jobId={jobId} title={job.data?.title} />
			{candidate.isPending ? (
				<SectionLoading label="Opening the candidate" />
			) : candidate.isError && (!candidate.data || gone) ? (
				<CandidateLoadError jobId={jobId} error={candidate.error} onRetry={() => void candidate.refetch()} />
			) : candidate.data ? (
				<CandidateDetails
					jobId={jobId}
					candidate={candidate.data}
					remove={remove}
					refreshFailed={candidate.isError}
					onRefresh={() => void candidate.refetch()}
				/>
			) : null}
		</div>
	);
}

function CandidateLoadError({ jobId, error, onRetry }: { jobId: string; error: Error; onRetry: () => void }) {
	const missing = error instanceof ApiError && error.status === 404;
	return (
		<SectionError
			title={missing ? "This candidate doesn't exist" : "We couldn't load this candidate"}
			message={missing ? "It may have been deleted, or it belongs to another company." : error.message}
			action={
				missing ? (
					<Link to="/dashboard/jobs/$jobId" params={{ jobId }} className="btn">
						Back to the job
					</Link>
				) : (
					<button type="button" className="btn" onClick={onRetry}>
						Try again
					</button>
				)
			}
		/>
	);
}

const count = (items: Requirement[]) => `${items.filter(({ met }) => met).length} of ${items.length}`;

function CandidateDetails({
	jobId,
	candidate,
	remove,
	refreshFailed,
	onRefresh,
}: {
	jobId: string;
	candidate: Candidate;
	remove: ReturnType<typeof useDeleteCandidate>;
	refreshFailed: boolean;
	onRefresh: () => void;
}) {
	const org = useOrg();
	const navigate = useNavigate();
	const retry = useRetryCandidate(jobId);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const name = candidateName(candidate);
	const score = candidate.status === "scored" ? candidate.score : null;
	const requirements = candidate.requirements ?? [];
	const must = requirements.filter(({ importance }) => importance === "must");
	const nice = requirements.filter(({ importance }) => importance === "nice");

	const retryButton = (className: string) =>
		candidate.canRetry && (
			<button type="button" className={className} disabled={retry.isPending} onClick={() => retry.mutate(candidate.id)}>
				{retry.isPending ? "Retrying" : "Retry"}
			</button>
		);

	const confirmDelete = () =>
		remove.mutate(undefined, {
			onSuccess: () =>
				void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId }, state: { deletedCandidate: name } }),
		});

	return (
		<>
			<PageHeading
				eyebrow="Candidate"
				title={name}
				actions={
					score !== null && (
						<span className="px-4">
							<span className="sr-only">Score </span>
							<ScoreRing score={score} className="text-[64px]" />
						</span>
					)
				}
			>
				{candidate.headline && (
					<p className="mt-3 font-mono text-[13.5px] text-ink-2 [overflow-wrap:anywhere]">{candidate.headline}</p>
				)}
				{/* One status region for every state, so the change from reading to scored is announced. */}
				<p
					role="status"
					className={
						isWorking(candidate)
							? "mt-4 inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card"
							: "mt-3 font-mono text-[12.5px] text-ink-muted empty:hidden"
					}
				>
					{isWorking(candidate) && (
						<>
							<span className="live-dot" aria-hidden="true" />
							Reading the CV
						</>
					)}
					{score !== null && `Scored ${score} · ${count(requirements)} requirements`}
				</p>
				{isWorking(candidate) && (isSlow(candidate) || candidate.canRetry) && (
					<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
						{isSlow(candidate) && (
							<p className="font-mono text-[12.5px] text-ink-muted">This is taking longer than usual.</p>
						)}
						{retryButton("btn ghost")}
					</div>
				)}
			</PageHeading>
			{refreshFailed && (
				<div className="mt-4">
					<RefreshFailed polling={isWorking(candidate)} onRetry={onRefresh} />
				</div>
			)}

			{candidate.status === "failed" && (
				<div className="mt-8">
					<SectionError
						title="We couldn't score this CV"
						message={candidate.error ?? "Scoring failed. Try again."}
						action={
							candidate.canRetry ? (
								retryButton("btn")
							) : (
								<p className="text-[15px] text-ink-2">
									We've tried this CV {MAX_SCORING_RUNS} times. It may not be a readable PDF.
								</p>
							)
						}
					/>
				</div>
			)}
			{retry.isError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {retry.error.message}
				</p>
			)}

			{candidate.summary && (
				<p className="mt-8 max-w-[62ch] text-[clamp(17px,1.45vw,20px)] leading-[1.55] text-ink-2">
					{candidate.summary}
				</p>
			)}

			{requirements.length > 0 && (
				<section aria-labelledby="requirements-h" className="mt-10">
					<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
						<h2
							id="requirements-h"
							className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]"
						>
							Requirements
						</h2>
						<p className="font-mono text-[12.5px] text-ink-muted">
							{[must.length > 0 && `Must-haves ${count(must)}`, nice.length > 0 && `Nice to have ${count(nice)}`]
								.filter(Boolean)
								.join(" · ")}
						</p>
					</div>
					<div className="mt-4 rounded-xl bg-sheet px-6 pb-2 shadow-card">
						<RequirementGroup heading="Must-haves" items={must} />
						<RequirementGroup heading="Nice to have" items={nice} />
					</div>
				</section>
			)}
			<InterviewQuestions jobId={jobId} candidate={candidate} />

			<p className="mt-10 font-mono text-[12.5px] text-ink-muted [overflow-wrap:anywhere]">
				CV file · {candidate.fileName} · {formatFileSize(candidate.fileSize)}
			</p>

			{org.role === "admin" && (
				<section aria-labelledby="danger-h" className="mt-12 border-t border-line pt-6">
					<h2 id="danger-h" className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
						Delete this candidate
					</h2>
					<p className="mt-2 max-w-[56ch] text-[15px] text-ink-2">
						Only admins can delete a candidate. They're removed for everyone at {org.name}, and the job still counts
						their CV toward its {CV_LIMIT_PER_JOB} free CVs.
					</p>
					<button type="button" className="btn danger mt-4" onClick={() => setConfirmingDelete(true)}>
						Delete candidate
					</button>
				</section>
			)}

			{confirmingDelete && (
				<DeleteDialog
					heading={`Delete “${name}”?`}
					confirmLabel="Delete candidate"
					busyLabel="Deleting"
					busy={remove.isPending}
					error={remove.isError ? remove.error.message : null}
					onCancel={() => {
						remove.reset();
						setConfirmingDelete(false);
					}}
					onConfirm={confirmDelete}
				>
					It's removed for everyone at {org.name}, with the CV file. You can't undo this.
				</DeleteDialog>
			)}
		</>
	);
}

// Must-haves or nice-to-haves, each with the quoted line from the CV that shows it, or a note that
// the CV doesn't.
function RequirementGroup({ heading, items }: { heading: string; items: Requirement[] }) {
	if (items.length === 0) return null;
	return (
		<section aria-label={heading}>
			<h3 className="pt-5 pb-1 font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">
				{heading}
			</h3>
			<ul>
				{items.map((item, index) => (
					<li key={`${item.label}-${index}`} className="border-b border-line-2 py-4 last:border-b-0">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
							<span className={`mk font-mono text-[12px] [overflow-wrap:anywhere] ${item.met ? "" : "mk-gap"}`}>
								{item.met ? item.label : `✕ ${item.label}`}
							</span>
							<span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-muted">
								{item.met && <Check />}
								{item.met ? "Met" : "Not met"}
							</span>
						</div>
						<p className="mt-2 text-[15px] text-ink-2 [overflow-wrap:anywhere]">{item.requirement}</p>
						{!item.met ? (
							<p className="mt-2 text-[14px] text-gap-ink">Not shown in the CV</p>
						) : (
							item.evidence && (
								<blockquote className="mt-2 border-l-[3px] border-ink pl-3 text-[15px] text-ink [overflow-wrap:anywhere]">
									“{item.evidence}”
								</blockquote>
							)
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
