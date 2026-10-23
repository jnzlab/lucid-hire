import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useOpenJobs } from "../dashboard/shell-data.ts";
import { type OverviewAttention, useOverviewAttention } from "../lib/overview.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PageHeader } from "../ui/page-header.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { CARD } from "./card.tsx";
import { FirstRun } from "./first-run.tsx";
import { Insights } from "./insights.tsx";
import { plural } from "./plural.ts";
import { WorkQueue } from "./work-queue.tsx";

// The first page after sign-in, work queue first (spec §4.1): what is waiting for a decision and what needs a
// person on the left, how hiring is going on the right (below it on narrow screens). A company without any job yet
// gets its first steps instead.
export function OverviewPage() {
	useDocumentTitle("Overview · LucidHire");
	const attention = useOverviewAttention();
	// The sidebar's open-jobs request also counts every job the company has, so it tells a brand-new company apart
	// without a request of its own. If it fails, the normal page shows.
	const jobs = useOpenJobs();
	const firstRun = jobs.data?.counts?.all === 0;

	return (
		<div className="wrap page">
			<PageHeader
				title="Overview"
				summary={firstRun ? "Three steps to your first ranked shortlist." : summary(attention.data, attention.isPending)}
				actions={
					firstRun ? undefined : (
						<Link to="/dashboard/jobs/new" className="btn">
							<Plus size={20} aria-hidden="true" />
							Post a job
						</Link>
					)
				}
			/>
			{jobs.isPending ? (
				<BodySkeleton />
			) : firstRun ? (
				<FirstRun />
			) : (
				<div className="@container mt-8">
					<div className="grid items-start gap-x-6 gap-y-10 @min-[880px]:grid-cols-[minmax(0,8fr)_minmax(320px,4fr)]">
						<WorkQueue attention={attention} />
						<Insights />
					</div>
				</div>
			)}
		</div>
	);
}

// The line under the h1, in plain words from the queue's totals: "14 candidates are waiting for your decision across
// 3 jobs. 2 CVs are being read." The number waiting is the one marked phrase. Nothing while the queue can't load
// (its card says why).
function summary(queue: OverviewAttention | undefined, pending: boolean): ReactNode {
	if (pending) return <Skeleton className="mt-1 h-4 w-80 max-w-full" />;
	if (!queue) return null;
	const { toReview, reading, failed, jobsToReview } = queue.totals;
	const sentences: ReactNode[] = [];
	if (toReview > 0) {
		sentences.push(
			<span key="review">
				<span className="mk">{plural(toReview, "candidate", "candidates")}</span> {toReview === 1 ? "is" : "are"} waiting for
				your decision{jobsToReview > 1 ? ` across ${jobsToReview} jobs` : ""}.
			</span>,
		);
	} else if (reading > 0 || failed > 0) {
		sentences.push("Nothing is waiting for your decision.");
	}
	if (reading > 0) sentences.push(`${plural(reading, "CV is", "CVs are")} being read.`);
	// Failed CVs are in "Needs attention"; the summary only mentions them when it has nothing else to say.
	if (failed > 0 && toReview === 0 && reading === 0) sentences.push(`${plural(failed, "CV", "CVs")} couldn't be read.`);
	if (sentences.length === 0) return "You're up to date.";
	return sentences.flatMap((sentence, index) => (index === 0 ? [sentence] : [" ", sentence]));
}

// Until the page knows whether this is a brand-new company, the shape of the usual page, without content.
function BodySkeleton() {
	return (
		<div className="@container mt-8">
			<div role="status" className="grid items-start gap-x-6 gap-y-10 @min-[880px]:grid-cols-[minmax(0,8fr)_minmax(320px,4fr)]">
				<span className="sr-only">Loading your overview</span>
				{[
					["h-56", "h-40"],
					["h-36", "h-72"],
				].map((heights, column) => (
					<div key={column} className="flex flex-col gap-4" aria-hidden="true">
						<Skeleton className="h-5 w-40" />
						{heights.map((height) => (
							<div key={height} className={`${CARD} ${height} p-5`}>
								<Skeleton lines={3} className="h-3" />
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
