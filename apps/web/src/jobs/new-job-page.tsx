import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "../components/icons.tsx";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import { useBilling } from "../lib/billing.ts";
import { formatNumber } from "../lib/format.ts";
import { useCreateJob } from "../lib/jobs.ts";
import { UpgradeAction } from "../settings/upgrade.tsx";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { JobForm } from "./job-form.tsx";
import { BackToJobs, PageHeading } from "./job-ui.tsx";

export function NewJobPage() {
	useDocumentTitle("New job · LucidHire");
	const navigate = useNavigate();
	const create = useCreateJob();
	const org = useOrg();
	const billing = useBilling();
	const usage = billing.data?.usage;
	// The API has the last word: it can refuse a job the page's cached count thought was fine.
	const refusal = create.error instanceof ApiError && create.error.code === "plan_limit" ? create.error.message : null;
	const refused = refusal !== null;
	const limit = usage?.jobsLimit ?? null;
	const used = usage?.jobsThisMonth ?? 0;
	const full = refused || (limit !== null && used >= limit);

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<BackToJobs />
			<PageHeading eyebrow="New job" title="Post a job">
				<p className="mt-4 max-w-[56ch] text-[17px] text-ink-2">
					Write it the way you'd brief a colleague. Save it as a draft, or open it now.
				</p>
				{usage && (
					<p className="mt-3 font-mono text-[13px] text-ink-muted">
						{limit === null
							? `Unlimited jobs on your plan · ${formatNumber(used)} created this month`
							: `${formatNumber(used)}/${formatNumber(limit)} jobs used this month`}
					</p>
				)}
			</PageHeading>
			<div className="mt-8">
				<JobForm
					saving={create.isPending}
					saveError={refused ? null : create.error}
					notice={
						full && (
							<div role="alert" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-gap-soft p-4 text-[15px]">
								<p className="min-w-0 flex-1 basis-72">
									✕{" "}
									{refusal ??
										`You've used all ${limit} new jobs this month. Deleting a job does not give the slot back.`}
								</p>
								<UpgradeAction isAdmin={org.role === "admin"} />
							</div>
						)
					}
					onSave={(input, intent) =>
						create.mutate(
							{ ...input, status: intent === "open" ? "open" : "draft" },
							{
								onSuccess: (job) =>
									void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId: job.id }, ignoreBlocker: true }),
							},
						)
					}
					actions={({ saving }) => (
						<>
							<Link to="/dashboard" className="btn ghost">
								Cancel
							</Link>
							<button type="submit" name="intent" value="draft" className="btn ghost" aria-disabled={saving} disabled={full}>
								Save as draft
							</button>
							<button type="submit" name="intent" value="open" className="btn" aria-disabled={saving} disabled={full}>
								{saving ? "Saving" : "Open job"} <ArrowRight />
							</button>
						</>
					)}
				/>
			</div>
		</div>
	);
}
