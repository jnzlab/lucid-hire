import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { Markdown } from "../../components/markdown-lazy.tsx";
import { type Job, useCoverImage } from "../../lib/jobs.ts";

// The job description as candidates read it: Markdown on a sheet on the desk, under the cover image if there is one.
// Every CV is scored against it, so the way to edit it sits right above.
export function DescriptionTab({ job }: { job: Job }) {
	const cover = useCoverImage(job.id, job.hasCover, job.updatedAt);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<p className="font-mono text-[12.5px] text-ink-muted">
					{job.status === "draft" ? "Candidates will read this on the apply page" : "Candidates read this on the apply page"} · every CV
					is scored against it
				</p>
				<Link to="/dashboard/jobs/$jobId/edit" params={{ jobId: job.id }} className="btn ghost xs">
					<Pencil size={16} aria-hidden="true" />
					Edit job
				</Link>
			</div>
			<article aria-label="Job description" className="desk rounded-2xl p-[clamp(12px,3vw,32px)]">
				<div className="mx-auto max-w-[760px] overflow-hidden rounded-sheet bg-sheet shadow-sheet">
					{job.hasCover && cover.data && <img src={cover.data} alt="" className="h-[clamp(120px,22vw,220px)] w-full object-cover" />}
					<div className="p-[clamp(20px,4vw,48px)]">
						<Markdown>{job.description}</Markdown>
					</div>
				</div>
			</article>
		</div>
	);
}
