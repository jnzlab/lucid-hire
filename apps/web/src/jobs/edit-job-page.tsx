import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { type Job, type JobInput, type JobStatus, useJob, useUpdateJob } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PageHeader } from "../ui/page-header.tsx";
import { useToast } from "../ui/use-toast.ts";
import { EditorSkeleton } from "./editor/editor-skeleton.tsx";
import { savedMessage } from "./editor/publish.ts";
import { JobForm } from "./job-form.tsx";
import { JobLoadError } from "./job-page.tsx";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Set when this page is opened right after duplicating a job.
		duplicatedJob?: boolean;
	}
}

export function EditJobPage({ jobId }: { jobId: string }) {
	const job = useJob(jobId);
	useDocumentTitle(job.data ? `Edit ${job.data.title} · LucidHire` : "Edit job · LucidHire");

	return (
		<div className="wrap page">
			{job.isPending ? (
				<EditorSkeleton label="Loading job" />
			) : job.isError ? (
				<JobLoadError error={job.error} onRetry={() => void job.refetch()} />
			) : (
				<EditJob job={job.data} />
			)}
		</div>
	);
}

// One line under the title about who can see the job now.
const SUMMARY: Record<JobStatus, string> = {
	open: "Candidates see your changes on the apply page as soon as you save.",
	draft: "It's a draft, so only your team can see it.",
	closed: "It's closed, so it takes no new CVs.",
};

function EditJob({ job }: { job: Job }) {
	const navigate = useNavigate();
	const toast = useToast();
	const update = useUpdateJob(job.id);
	const duplicated = useRouterState({ select: (state) => state.location.state.duplicatedJob });
	const jobPath = `/dashboard/jobs/${job.id}`;

	const save = (input: JobInput, status: JobStatus) => {
		const previous = job.status;
		// Only a status that changed is sent, so saving the words never reopens or closes anything by accident.
		update.mutate(status === previous ? input : { ...input, status }, {
			onSuccess: (saved) => {
				toast.show(savedMessage("edit", saved.status, previous));
				void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId: job.id }, ignoreBlocker: true });
			},
		});
	};

	return (
		<>
			<PageHeader
				breadcrumbs={[{ label: "Jobs", href: "/dashboard/jobs" }, { label: job.title, href: jobPath }, { label: "Edit" }]}
				title="Edit job"
				summary={SUMMARY[job.status]}
			>
				{duplicated && (
					<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
						<AnnouncedBanner message="Duplicated as a draft" />
						<p className="text-[14px] text-ink-muted">Change what's different, then save. It stays a draft until you open it.</p>
					</div>
				)}
			</PageHeader>
			<div className="mt-8">
				<JobForm mode="edit" job={job} saving={update.isPending} saveError={update.error} cancelHref={jobPath} onSave={save} />
			</div>
		</>
	);
}
