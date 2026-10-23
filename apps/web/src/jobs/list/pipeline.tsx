import { formatNumber } from "../../lib/format.ts";
import { Tooltip } from "../../ui/tooltip.tsx";
import { type PipelineCounts, type PipelineSegment, cvsOnJob, pipelineLabel, pipelineSegments } from "./summaries.ts";

// Tokens only (design system §4 Charts): shortlisted in ink, to review in marker with an outline (yellow alone barely
// shows on paper), reading hatched, not a fit in line.
const SEGMENT_LOOK: Record<PipelineSegment["key"], string> = {
	shortlisted: "bg-ink",
	review: "bg-marker shadow-[inset_0_0_0_1.5px_var(--on-marker)]",
	reading: "bg-line-2 bg-[image:repeating-linear-gradient(135deg,var(--ink-faint)_0_1.5px,transparent_1.5px_4.5px)]",
	rejected: "bg-line",
};

// A job's pipeline as a small stacked bar with a caption under it. The caption is what a recruiter acts on (to
// review and shortlisted, plus any CV still being read or that failed); the bar shows the proportions, and hovering
// it lists every number. To screen readers the whole thing is one image named by `pipelineLabel`. A click on the bar
// goes to `onActivate` (the row's link), so it leaves no dead spot in a clickable row.
export function Pipeline({ job, onActivate }: { job: PipelineCounts; onActivate?: () => void }) {
	const label = pipelineLabel(job);
	const empty = cvsOnJob(job) === 0;

	return (
		<div role="img" aria-label={`Pipeline: ${label}`} className="min-w-0">
			{empty ? (
				<span className="block h-2.5 rounded-[3px] border border-dashed border-line" />
			) : (
				<Tooltip content={label} describe={false}>
					<span className="relative z-10 -my-1 block cursor-pointer py-1" onClick={onActivate}>
						<span className="flex h-2.5 gap-0.5">
							{pipelineSegments(job).map((segment) => (
								<span
									key={segment.key}
									className={`block min-w-1.5 basis-0 rounded-[2px] ${SEGMENT_LOOK[segment.key]}`}
									style={{ flexGrow: segment.count }}
								/>
							))}
						</span>
					</span>
				</Tooltip>
			)}
			<p className="mt-2 font-mono text-[12px] leading-[1.45] text-ink-muted">
				{empty ? (
					label
				) : (
					<>
						{/* Each part after the first keeps its separator, so a wrapped line starts with "·" rather than ending with one. */}
						<span className={`whitespace-nowrap ${job.toReviewCount > 0 ? "text-ink" : ""}`}>
							{formatNumber(job.toReviewCount)} to review
						</span>{" "}
						<span className={`whitespace-nowrap ${job.shortlistedCount > 0 ? "text-ink-2" : ""}`}>
							<span className="text-ink-muted">·</span> {formatNumber(job.shortlistedCount)} shortlisted
						</span>
						{job.readingCount > 0 && (
							<>
								{" "}
								<span className="whitespace-nowrap text-ink-2">
									<span className="text-ink-muted">·</span>{" "}
									<span className="live-dot mr-1 inline-block size-[7px] align-[1px]" />
									{formatNumber(job.readingCount)} reading
								</span>
							</>
						)}
						{job.failedCount > 0 && (
							<>
								{" "}
								<span className="whitespace-nowrap text-gap-ink">
									<span className="text-ink-muted">·</span> ✕ {formatNumber(job.failedCount)} failed
								</span>
							</>
						)}
					</>
				)}
			</p>
		</div>
	);
}
