import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "../components/icons.tsx";
import { useCreateJob } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { JobForm } from "./job-form.tsx";
import { BackToJobs, PageHeading } from "./job-ui.tsx";

export function NewJobPage() {
	useDocumentTitle("New job · LucidHire");
	const navigate = useNavigate();
	const create = useCreateJob();

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<BackToJobs />
			<PageHeading eyebrow="New job" title="Post a job">
				<p className="mt-4 max-w-[56ch] text-[17px] text-ink-2">
					Write it the way you'd brief a colleague. Save it as a draft, or open it now.
				</p>
			</PageHeading>
			<div className="mt-8">
				<JobForm
					saving={create.isPending}
					saveError={create.error}
					onSave={(input, intent) =>
						create.mutate(
							{ ...input, status: intent === "open" ? "open" : "draft" },
							{ onSuccess: (job) => void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId: job.id } }) },
						)
					}
					actions={({ saving }) => (
						<>
							<Link to="/dashboard" className="btn ghost">
								Cancel
							</Link>
							<button type="submit" name="intent" value="draft" className="btn ghost" disabled={saving}>
								Save as draft
							</button>
							<button type="submit" name="intent" value="open" className="btn" disabled={saving}>
								{saving ? "Saving" : "Open job"} <ArrowRight />
							</button>
						</>
					)}
				/>
			</div>
		</div>
	);
}
