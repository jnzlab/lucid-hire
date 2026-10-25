import { useNavigate } from "@tanstack/react-router";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import { useBilling } from "../lib/billing.ts";
import { formatNumber } from "../lib/format.ts";
import { type Job, useCreateJob, useUploadCover } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { UpgradeAction } from "../settings/upgrade.tsx";
import { Meter } from "../ui/meter.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useToast } from "../ui/use-toast.ts";
import { savedMessage } from "./editor/publish.ts";
import { JobForm } from "./job-form.tsx";

export function NewJobPage() {
	useDocumentTitle("New job · LucidHire");
	const navigate = useNavigate();
	const toast = useToast();
	const create = useCreateJob();
	const upload = useUploadCover();
	const org = useOrg();
	const billing = useBilling();
	const usage = billing.data?.usage;
	// The API has the last word: it can refuse a job the page's cached count thought was fine.
	const refusal = create.error instanceof ApiError && create.error.code === "plan_limit" ? create.error.message : null;
	const limit = usage?.jobsLimit ?? null;
	const used = usage?.jobsThisMonth ?? 0;
	const full = refusal !== null || (limit !== null && used >= limit);

	const opened = (job: Job, coverFailed: boolean) => {
		toast.show(savedMessage("new", job.status));
		// The job is saved either way; only the image needs another go, from Edit job.
		if (coverFailed) toast.error("The cover image didn't upload. Add it from Edit job.");
		void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId: job.id }, ignoreBlocker: true });
	};

	return (
		<div className="wrap page">
			<PageHeader
				breadcrumbs={[{ label: "Jobs", href: "/dashboard/jobs" }, { label: "Post a job" }]}
				title="Post a job"
				summary="Write it the way you'd brief a colleague. Save it as a draft, or open it now."
			/>
			<div className="mt-8">
				<JobForm
					mode="new"
					saving={create.isPending || upload.isPending}
					saveError={refusal ? null : create.error}
					cancelHref="/dashboard/jobs"
					allowance={
						billing.isPending ? (
							<Skeleton label="Loading your job allowance" className="h-3.5 w-full" />
						) : usage && limit === null ? (
							<p className="font-mono text-[12.5px] text-ink-muted">
								Unlimited jobs on your plan · {formatNumber(used)} created this month
							</p>
						) : usage && limit !== null ? (
							<Meter label="Jobs this month" value={used} max={limit} valueText={`${formatNumber(used)} of ${formatNumber(limit)}`} />
						) : null
					}
					blocked={
						full && (
							<div role="alert" className="rounded-lg bg-gap-soft px-4 py-3 text-[14px] leading-[1.45] text-ink">
								<p>
									✕{" "}
									{refusal ??
										`You've used all ${limit} new jobs this month. Deleting a job does not give the slot back.`}
								</p>
								<div className="mt-1">
									<UpgradeAction isAdmin={org.role === "admin"} />
								</div>
							</div>
						)
					}
					onSave={(input, status, cover) =>
						create.mutate(
							{ ...input, status: status === "open" ? "open" : "draft" },
							{
								onSuccess: (job) => {
									if (!cover) return opened(job, false);
									upload.mutate(
										{ id: job.id, file: cover },
										{ onSuccess: (withCover) => opened(withCover, false), onError: () => opened(job, true) },
									);
								},
							},
						)
					}
				/>
			</div>
		</div>
	);
}
