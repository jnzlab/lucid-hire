import { useId } from "react";
import { AppLink } from "../ui/app-link.tsx";
import { CountBadge } from "../ui/count-badge.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { NEW_JOB_PATH, currentJobId } from "./nav.ts";
import { useOpenJobs } from "./shell-data.ts";

const OPEN_JOBS_SHOWN = 6;

// The sidebar's "Open jobs": up to six, each with its to-review count, or a live dot while CVs are being read. The
// job you're on is marked like a nav item. `onNavigate` closes the mobile sheet.
export function OpenJobs({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
	const jobs = useOpenJobs();
	const current = currentJobId(pathname);
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-1">
			<h2 id={headingId} className="px-2.5 pb-1 font-mono text-[11.5px] tracking-[.08em] text-ink-muted uppercase">
				Open jobs
			</h2>
			{jobs.isPending ? (
				<div className="flex flex-col gap-3 px-2.5 py-2">
					<Skeleton className="h-3 w-4/5" label="Loading open jobs" />
					<Skeleton className="h-3 w-3/5" />
					<Skeleton className="h-3 w-2/3" />
				</div>
			) : jobs.isError ? (
				<p className="px-2.5 font-mono text-[12.5px] text-ink-muted">
					Couldn't load your jobs.{" "}
					<button type="button" onClick={() => void jobs.refetch()} className="inline-flex min-h-8 items-center underline underline-offset-[.18em] hover:text-ink pointer-coarse:min-h-11">
						Try again
					</button>
				</p>
			) : jobs.data.jobs.length === 0 ? (
				<p className="px-2.5 text-[14px] text-ink-muted">
					No open jobs.{" "}
					<AppLink href={NEW_JOB_PATH} onClick={onNavigate} className="font-semibold text-ink underline underline-offset-[.18em]">
						Post a job
					</AppLink>
				</p>
			) : (
				<>
					<ul className="flex flex-col gap-0.5">
						{jobs.data.jobs.slice(0, OPEN_JOBS_SHOWN).map((job) => {
							const here = job.id === current;
							const exact = here && /^\/dashboard\/jobs\/[^/]+\/?$/.test(pathname);
							return (
								<li key={job.id}>
									<AppLink
										href={`/dashboard/jobs/${job.id}`}
										onClick={onNavigate}
										aria-current={here ? (exact ? "page" : "true") : undefined}
										title={job.title}
										className={`nav-item is-dense ${here ? "on-marker-area" : ""}`}
									>
										<span className="min-w-0 flex-1 truncate">{job.title}</span>
										{job.readingCount > 0 && (
											<span className="flex items-center" title="Reading CVs">
												<span className="live-dot" aria-hidden="true" />
												<span className="sr-only">, reading {job.readingCount} CVs</span>
											</span>
										)}
										<CountBadge count={job.toReviewCount} variant="marker" label="to review" />
									</AppLink>
								</li>
							);
						})}
					</ul>
					{jobs.data.total > OPEN_JOBS_SHOWN && (
						<AppLink
							href="/dashboard/jobs?status=open"
							onClick={onNavigate}
							className="nav-item is-dense font-mono text-[12.5px] text-ink-muted"
						>
							All {jobs.data.total} open jobs <span aria-hidden="true">→</span>
						</AppLink>
					)}
				</>
			)}
		</section>
	);
}
