import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../lib/format.ts";
import { type Job, type JobStatus, useCoverImage } from "../../lib/jobs.ts";

// The cover as it is saved now; shared with the cover field through the query cache.
function CoverThumb({ job }: { job: Job }) {
	const image = useCoverImage(job.id, job.hasCover, job.updatedAt);
	if (!job.hasCover || !image.data) return null;
	return <img src={image.data} alt="" className="mb-4 h-24 w-full rounded-md object-cover" />;
}

const NOTE: Record<JobStatus, string> = {
	open: "The apply page goes live when you save.",
	draft: "The apply page goes live when you open the job.",
	closed: "The apply page stays up and says the job is closed.",
};

// The top of the public apply page, drawn from the form as it's typed: the status pill, the company, the title. On a
// saved job that candidates can see, "Open preview" opens the real page in a new tab (it shows what was last saved).
export function CandidateView({
	title,
	status,
	company,
	job,
}: {
	title: string;
	// The status the job will have once saved.
	status: JobStatus;
	company: string;
	// The saved job, on the edit page.
	job?: Job;
}) {
	// A new job is posted the day it's saved.
	const [today] = useState(() => new Date().toISOString());
	const shown = title.trim();
	const live = job && job.status !== "draft";
	const open = status === "open";

	return (
		<section aria-labelledby="candidate-view-h" className="rounded-xl bg-sheet p-5 shadow-card min-[561px]:p-6">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h2 id="candidate-view-h" className="text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Candidate view
				</h2>
				{live && (
					<a
						href={`/jobs/${job.slug}`}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-1.5 rounded-[3px] text-[14px] font-semibold underline underline-offset-[.18em]"
					>
						Open preview
						<ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
						<span className="sr-only">(opens in a new tab)</span>
					</a>
				)}
			</div>
			<div className="desk mt-4 rounded-lg p-3">
				<div className="rounded-sheet bg-sheet p-4 shadow-sheet">
					{job && <CoverThumb job={job} />}
					<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] tracking-[.08em] text-ink-muted uppercase">
						<span
							className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border border-line bg-sheet px-2 text-[12px] tracking-normal normal-case ${open ? "text-ink" : "text-ink-muted"}`}
						>
							<i className={`size-2 rounded-full ${open ? "bg-ink" : "bg-ink-faint"}`} aria-hidden="true" />
							{status === "draft" ? "Draft · not public" : open ? "Open role" : "Closed role"}
						</span>
						<span className="[overflow-wrap:anywhere]">{company}</span>
						<span>Posted {formatDate(job?.createdAt ?? today)}</span>
					</p>
					<p
						className={`mt-3 font-display text-[22px] leading-[1.05] font-[820] tracking-[-0.03em] [overflow-wrap:anywhere] [font-stretch:112%] ${shown ? "text-ink" : "text-ink-faint"}`}
					>
						{shown || "Job title"}
					</p>
				</div>
			</div>
			<p className="mt-3 text-[13px] leading-[1.45] text-ink-muted">
				{live && status === job.status
					? "Open preview shows the page as last saved."
					: job?.status === "closed" && open
						? "Applications reopen when you save."
						: NOTE[status]}
			</p>
		</section>
	);
}
