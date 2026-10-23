import { PLANS } from "@lucid-hire/plans";
import { CV_LIMIT_PER_JOB, type CandidateList, cvNoun } from "../../lib/candidates.ts";
import { formatNumber } from "../../lib/format.ts";
import type { Job } from "../../lib/jobs.ts";

// Why a job that isn't open can't take CVs, and what to do about it.
export const CLOSED_NOTE = {
	draft: "This job is a draft, so it can't take CVs yet. Open it to start uploading.",
	closed: "This job is closed, so it can't take new CVs. Reopen it to upload more.",
} as const;

export type Capacity = {
	used: number;
	limit: number;
	slotsLeft: number;
	// Why the job can't take CVs right now, or null when it can.
	note: string | null;
	// The job is open but has used every CV its plan gives it.
	full: boolean;
	// Full, and a bigger plan would help (the top plan has nothing to upgrade to).
	upgradable: boolean;
	// "4 of 10 free CVs used". Deleted CVs still count.
	usage: string;
};

// How many CVs the job can still take. The list's counts win once it has loaded; until then the job's own count and
// Free's limit stand in, but the job is never called full, because the plan's real limit isn't known yet.
export function capacityOf(job: Pick<Job, "status" | "cvCount">, list: Pick<CandidateList, "cvCount" | "cvLimit"> | undefined): Capacity {
	const used = list?.cvCount ?? job.cvCount;
	const limit = list?.cvLimit ?? CV_LIMIT_PER_JOB;
	const slotsLeft = Math.max(0, limit - used);
	const full = list !== undefined && job.status === "open" && slotsLeft === 0;
	const note =
		job.status !== "open" ? CLOSED_NOTE[job.status] : full ? `This job has used its ${formatNumber(limit)} ${cvNoun(limit)}.` : null;
	return {
		used,
		limit,
		slotsLeft,
		note,
		full,
		upgradable: full && limit < PLANS.max.cvsPerJob,
		usage: list ? `${formatNumber(used)} of ${formatNumber(limit)} ${cvNoun(limit)} used` : `${formatNumber(used)} ${used === 1 ? "CV" : "CVs"}`,
	};
}
