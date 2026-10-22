import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { type Job, useJob, useUpdateJob } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { CoverField } from "./cover-field.tsx";
import { JobForm } from "./job-form.tsx";
import { JobLoadError } from "./job-page.tsx";
import { BackToJobs, PageHeading, SectionLoading } from "./job-ui.tsx";

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
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<BackToJobs />
			{job.isPending ? (
				<SectionLoading label="Loading job" page />
			) : job.isError ? (
				<JobLoadError error={job.error} onRetry={() => void job.refetch()} />
			) : (
				<EditJob job={job.data} />
			)}
		</div>
	);
}

function EditJob({ job }: { job: Job }) {
	const navigate = useNavigate();
	const update = useUpdateJob(job.id);
	const duplicated = useRouterState({ select: (state) => state.location.state.duplicatedJob });
	const toJob = { to: "/dashboard/jobs/$jobId", params: { jobId: job.id } } as const;

	return (
		<>
			<PageHeading eyebrow="Edit job" title={job.title} />
			<AnnouncedBanner message={duplicated ? "Duplicated as a draft" : undefined} className="mt-6" />
			<div className="mt-8">
				<CoverField job={job} />
			</div>
			<div className="mt-8">
				<JobForm
					initial={{ title: job.title, description: job.description }}
					saving={update.isPending}
					saveError={update.error}
					onSave={(input) => update.mutate(input, { onSuccess: () => void navigate({ ...toJob, ignoreBlocker: true }) })}
					actions={({ saving }) => (
						<>
							<Link {...toJob} className="btn ghost">
								Cancel
							</Link>
							<button type="submit" className="btn" aria-disabled={saving}>
								{saving ? "Saving" : "Save changes"}
							</button>
						</>
					)}
				/>
			</div>
		</>
	);
}
