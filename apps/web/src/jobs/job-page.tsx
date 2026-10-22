import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CandidatesSection } from "../candidates/candidates-section.tsx";
import { DeleteDialog } from "../components/delete-dialog.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import { useCandidates } from "../lib/candidates.ts";
import { formatDate } from "../lib/format.ts";
import { type Job, type JobStatus, useDeleteJob, useJob, useUpdateJob } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { BackToJobs, JobStatusTag, PageHeading, SectionError, SectionLoading } from "./job-ui.tsx";

export function JobPage({ jobId }: { jobId: string }) {
	const job = useJob(jobId);
	useDocumentTitle(job.data ? `${job.data.title} · LucidHire` : "Job · LucidHire");

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<BackToJobs />
			{job.isPending ? (
				<SectionLoading label="Loading job" page />
			) : job.isError ? (
				<JobLoadError error={job.error} onRetry={() => void job.refetch()} />
			) : (
				<JobDetails job={job.data} />
			)}
		</div>
	);
}

export function JobLoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
	const missing = error instanceof ApiError && error.status === 404;
	return (
		<SectionError
			level={1}
			title={missing ? "This job doesn't exist" : "We couldn't load this job"}
			message={missing ? "It may have been deleted, or it belongs to another company." : error.message}
			action={
				missing ? (
					<Link to="/dashboard" className="btn">
						Back to your jobs
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

// What the status button does next, what is announced once it has, and what the status means for the recruiter.
const NEXT_STATUS: Record<JobStatus, { to: JobStatus; label: string; done: string; note: string }> = {
	draft: { to: "open", label: "Open job", done: "Job opened", note: "Draft. It isn't taking CVs yet." },
	open: { to: "closed", label: "Close job", done: "Job closed", note: "Open. It's taking CVs." },
	closed: { to: "open", label: "Reopen job", done: "Job reopened", note: "Closed. It isn't taking new CVs." },
};

function JobDetails({ job }: { job: Job }) {
	const org = useOrg();
	const navigate = useNavigate();
	const update = useUpdateJob(job.id);
	const remove = useDeleteJob(job.id);
	// The CVs that go with the job: the ones listed now, or the upload count until the list has loaded.
	const cvs = useCandidates(job.id).data?.candidates.length ?? job.cvCount;
	const removed = cvs > 0 ? `It and its ${cvs} ${cvs === 1 ? "CV are" : "CVs are"} removed` : "It's removed";
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	// What screen readers are told after the status changes. The region stays on the page, so a change is announced.
	const [announcement, setAnnouncement] = useState("");
	const next = NEXT_STATUS[job.status];

	const changeStatus = () => {
		if (update.isPending) return;
		setAnnouncement("");
		update.mutate({ status: next.to }, { onSuccess: () => setAnnouncement(next.done) });
	};

	const confirmDelete = () =>
		remove.mutate(undefined, {
			onSuccess: () => void navigate({ to: "/dashboard", state: { deletedJob: job.title } }),
		});

	return (
		<>
			<PageHeading
				eyebrow={org.name}
				title={job.title}
				actions={
					<>
						<Link to="/dashboard/jobs/$jobId/edit" params={{ jobId: job.id }} className="btn ghost">
							Edit job
						</Link>
						{/* Only looks disabled while it saves, so it keeps keyboard focus; changeStatus ignores the click. */}
						<button
							type="button"
							className={next.to === "closed" ? "btn ghost" : "btn"}
							aria-disabled={update.isPending}
							onClick={changeStatus}
						>
							{update.isPending ? "Saving" : next.label}
							{next.to === "open" && !update.isPending && <ArrowRight />}
						</button>
					</>
				}
			>
				<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
					<JobStatusTag status={job.status} />
					<p className="font-mono text-[12px] text-ink-muted">
						{next.note} Created {formatDate(job.createdAt)}
						{job.updatedAt !== job.createdAt && ` · Edited ${formatDate(job.updatedAt)}`}
					</p>
				</div>
			</PageHeading>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			{update.isError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {update.error.message}
				</p>
			)}

			<CandidatesSection job={job} />

			<article aria-label="Job description" className="desk mt-10 rounded-2xl p-[clamp(16px,4vw,40px)]">
				<div className="mx-auto max-w-[760px] rounded-sheet bg-sheet p-[clamp(20px,4vw,48px)] shadow-sheet">
					<p className="text-[16px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
						{job.description}
					</p>
				</div>
			</article>

			{org.role === "admin" && (
				<section aria-labelledby="danger-h" className="mt-12 border-t border-line pt-6">
					<h2 id="danger-h" className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
						Delete this job
					</h2>
					<p className="mt-2 max-w-[56ch] text-[15px] text-ink-2">
						Only admins can delete a job. It's removed for everyone at {org.name}.
					</p>
					<button type="button" className="btn danger mt-4" onClick={() => setConfirmingDelete(true)}>
						Delete job
					</button>
				</section>
			)}

			{confirmingDelete && (
				<DeleteDialog
					heading={`Delete “${job.title}”?`}
					confirmLabel="Delete job"
					busyLabel="Deleting"
					busy={remove.isPending}
					error={remove.isError ? remove.error.message : null}
					onCancel={() => {
						remove.reset();
						setConfirmingDelete(false);
					}}
					onConfirm={confirmDelete}
				>
					{removed} for everyone at {org.name}. You can't undo this.
				</DeleteDialog>
			)}
		</>
	);
}
