import { formatNumber } from "../../lib/format.ts";
import type { JobCounts, JobListItem } from "../../lib/jobs.ts";

export type PipelineCounts = Pick<
	JobListItem,
	"cvCount" | "scoredCount" | "toReviewCount" | "shortlistedCount" | "rejectedCount" | "readingCount" | "failedCount"
>;

export type PipelineSegment = { key: "shortlisted" | "review" | "reading" | "rejected"; count: number; label: string };

// The CVs on a job now, by status: what goes with it when it's deleted. `cvCount` also counts deleted CVs (it's the
// plan allowance), so it isn't used for this.
export const cvsOnJob = (job: Pick<JobListItem, "scoredCount" | "readingCount" | "failedCount">) =>
	job.scoredCount + job.readingCount + job.failedCount;

// The pipeline bar's parts, left to right: shortlisted, waiting for a decision, still being read, not a fit. Failed
// CVs have no part (the caption names them). Empty parts are left out.
export function pipelineSegments(job: PipelineCounts): PipelineSegment[] {
	const segments: PipelineSegment[] = [
		{ key: "shortlisted", count: job.shortlistedCount, label: "shortlisted" },
		{ key: "review", count: job.toReviewCount, label: "to review" },
		{ key: "reading", count: job.readingCount, label: "reading" },
		{ key: "rejected", count: job.rejectedCount, label: "not a fit" },
	];
	return segments.filter((segment) => segment.count > 0);
}

// The whole pipeline in words, for screen readers and the bar's tooltip: "9 to review, 3 shortlisted, 4 not a fit,
// 3 reading, 1 failed". To review and shortlisted are always said, the rest only when there are some.
export function pipelineLabel(job: PipelineCounts): string {
	if (cvsOnJob(job) === 0) return job.cvCount === 0 ? "No CVs yet" : "No candidates";
	const parts = [
		`${formatNumber(job.toReviewCount)} to review`,
		`${formatNumber(job.shortlistedCount)} shortlisted`,
		job.rejectedCount > 0 && `${formatNumber(job.rejectedCount)} not a fit`,
		job.readingCount > 0 && `${formatNumber(job.readingCount)} reading`,
		job.failedCount > 0 && `${formatNumber(job.failedCount)} failed`,
	];
	return parts.filter(Boolean).join(", ");
}

// The page summary under "Jobs": "5 open · 2 drafts · 2 closed". Statuses with no jobs are left out; null with none.
export function statusSummary(counts: JobCounts): string | null {
	const parts = [
		counts.open > 0 && `${formatNumber(counts.open)} open`,
		counts.draft > 0 && `${formatNumber(counts.draft)} ${counts.draft === 1 ? "draft" : "drafts"}`,
		counts.closed > 0 && `${formatNumber(counts.closed)} closed`,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : null;
}

// The name a row shows for the best CV: the first name, as a person would say it.
export function firstName(name: string | null): string {
	return name?.trim().split(/\s+/)[0] || "Unnamed CV";
}
