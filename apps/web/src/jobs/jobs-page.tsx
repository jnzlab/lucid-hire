import { Link, useRouterState } from "@tanstack/react-router";
import { AnnouncedBanner } from "../components/announced-banner.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { Swipe } from "../components/swipe.tsx";
import { useOrg } from "../dashboard/org.ts";
import { formatDate } from "../lib/format.ts";
import { type JobSummary, useJobs } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { JobStatusTag, PageHeading, SectionError, SectionLoading } from "./job-ui.tsx";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Set by the job page after a delete, for the confirmation on the list.
		deletedJob?: string;
	}
}

export function JobsPage() {
	useDocumentTitle("Jobs · LucidHire");
	const org = useOrg();
	const jobs = useJobs();
	const deletedJob = useRouterState({ select: (state) => state.location.state.deletedJob });

	const newJob = (
		<Link to="/dashboard/jobs/new" className="btn">
			Post a job <ArrowRight />
		</Link>
	);

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<PageHeading eyebrow={org.name} title="Jobs" actions={jobs.data?.length ? newJob : null} />
			<AnnouncedBanner message={deletedJob && `Deleted “${deletedJob}”`} className="mt-6" />
			<div className="mt-8">
				{jobs.isPending ? (
					<SectionLoading label="Loading your jobs" />
				) : jobs.isError ? (
					<SectionError
						title="We couldn't load your jobs"
						message={jobs.error.message}
						action={
							<button type="button" className="btn" onClick={() => void jobs.refetch()}>
								Try again
							</button>
						}
					/>
				) : jobs.data.length === 0 ? (
					<NoJobsYet />
				) : (
					<JobList jobs={jobs.data} />
				)}
			</div>
		</div>
	);
}

function JobList({ jobs }: { jobs: JobSummary[] }) {
	return (
		<section aria-labelledby="jobs-list-h" className="rounded-xl bg-sheet px-6 shadow-card">
			<h2 id="jobs-list-h" className="sr-only">
				Your jobs
			</h2>
			<ul>
				{jobs.map((job) => (
					<li key={job.id} className="border-b border-line-2 last:border-b-0">
						<Link
							to="/dashboard/jobs/$jobId"
							params={{ jobId: job.id }}
							className="group -mx-3 my-1.5 flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md px-3 py-3 hover:bg-paper-2"
						>
							<span className="min-w-0">
								<span className="block text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em]">
									{job.title}
								</span>
								<span className="mt-1 block font-mono text-[12px] text-ink-muted">
									Created {formatDate(job.createdAt)}
									{job.cvCount > 0 && ` · ${job.cvCount} ${job.cvCount === 1 ? "CV" : "CVs"}`}
								</span>
							</span>
							<JobStatusTag status={job.status} />
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}

function NoJobsYet() {
	return (
		<section
			aria-labelledby="no-jobs-h"
			className="desk flex flex-col items-center rounded-2xl px-6 py-[clamp(40px,7vw,80px)] text-center"
		>
			<div className="relative grid h-[150px] w-[220px] place-items-center" aria-hidden="true">
				<Swipe className="absolute top-1/2 left-1/2 h-auto w-[300px] max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-6" />
				<div className="relative flex h-[132px] w-[176px] flex-col gap-2.5 rounded-sheet bg-sheet p-4 shadow-sheet">
					<i className="h-2.5 w-3/5 rounded-[4px] bg-ink" />
					<i className="h-2 w-2/5 rounded-[4px] bg-line" />
					<i className="mt-2 h-2 w-full rounded-[4px] bg-line-2" />
					<i className="h-2 w-11/12 rounded-[4px] bg-line-2" />
					<i className="h-2 w-4/5 rounded-[4px] bg-line-2" />
				</div>
			</div>
			<h2 id="no-jobs-h" className="mt-8 text-[24px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:110%]">
				No jobs yet
			</h2>
			<p className="mt-3 max-w-[46ch] text-[17px] text-ink-2">
				When you post a job, every CV it gets is read in full, scored against your requirements and ranked here, with
				the evidence beside each score.
			</p>
			<Link to="/dashboard/jobs/new" className="btn mt-7">
				Post your first job <ArrowRight />
			</Link>
		</section>
	);
}
