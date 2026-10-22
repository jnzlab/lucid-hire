import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowRight } from "../components/icons.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
import { useOrg } from "../dashboard/org.ts";
import { PageHeading, SectionError, SectionLoading } from "../jobs/job-ui.tsx";
import { formatNumber, formatRelative } from "../lib/format.ts";
import { type ActivityEvent, type Overview, useOverview } from "../lib/overview.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { useNow } from "../lib/use-now.ts";
import { AiMix, CardEmpty, Funnel, VelocityChart } from "./charts.tsx";

export function OverviewPage() {
	useDocumentTitle("Overview · LucidHire");
	const org = useOrg();
	const overview = useOverview();

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<PageHeading
				eyebrow={org.name}
				title="Overview"
				actions={
					<Link to="/dashboard/jobs/new" className="btn">
						Post a job <ArrowRight />
					</Link>
				}
			/>
			<div className="mt-8">
				{overview.isPending ? (
					<SectionLoading label="Loading your overview" />
				) : overview.isError ? (
					<SectionError
						title="We couldn't load your overview"
						message={overview.error.message}
						action={
							<button type="button" className="btn" onClick={() => void overview.refetch()}>
								Try again
							</button>
						}
					/>
				) : (
					<OverviewCards overview={overview.data} />
				)}
			</div>
		</div>
	);
}

function OverviewCards({ overview }: { overview: Overview }) {
	return (
		<div className="flex flex-col gap-6">
			<KpiRow kpis={overview.kpis} />
			<div className="grid gap-6 min-[1000px]:grid-cols-2">
				<Card id="velocity-h" title="Pipeline velocity">
					<VelocityChart velocity={overview.velocity} />
				</Card>
				<div className="flex flex-col gap-6">
					<Card id="funnel-h" title="90-day funnel">
						<Funnel funnel={overview.funnel} />
					</Card>
					<Card id="mix-h" title="AI output mix">
						<AiMix mix={overview.aiMix} />
					</Card>
				</div>
			</div>
			<Card id="activity-h" title="Recent activity">
				<Activity events={overview.activity} />
			</Card>
		</div>
	);
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section aria-labelledby={id} className="min-w-0 rounded-xl bg-sheet p-6 shadow-card">
			<h2 id={id} className="mb-4 text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				{title}
			</h2>
			{children}
		</section>
	);
}

// "+3 vs last month", in words as well as a sign, so it never depends on colour.
function change(delta: number, noun: string) {
	if (delta === 0) return `No change vs ${noun}`;
	return `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} vs ${noun}`;
}

function hoursText(hours: number) {
	return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`;
}

function shortlistChange({ hours, previousHours }: Overview["kpis"]["avgTimeToShortlist"]) {
	if (hours === null) return "Shortlist a CV to see this";
	if (previousHours === null) return "No shortlists in the 30 days before";
	const diff = hours - previousHours;
	if (Math.abs(diff) < 0.05) return "No change vs the 30 days before";
	return `${hoursText(Math.abs(diff))} ${diff < 0 ? "faster" : "slower"} than the 30 days before`;
}

const kpiCard = "min-w-0 rounded-xl bg-sheet p-5 shadow-card";
const kpiLabel = "font-mono text-[11px] tracking-[.08em] text-ink-muted uppercase";
const kpiValue = "mt-2 font-display text-[40px] leading-none font-[800] tracking-[-0.03em] tabular-nums [font-stretch:108%]";
const kpiNote = "mt-2 text-[13.5px] text-ink-2";

function KpiRow({ kpis }: { kpis: Overview["kpis"] }) {
	const { activeRoles, cvsScreened, avgTimeToShortlist, topMatch } = kpis;
	return (
		<section aria-label="Key numbers">
			<dl className="grid gap-4 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4">
				<div className={kpiCard}>
					<dt className={kpiLabel}>Active roles</dt>
					<dd className={kpiValue}>{formatNumber(activeRoles.value)}</dd>
					<dd className={kpiNote}>
						{activeRoles.value === 0 && activeRoles.change === 0
							? "No open jobs. Open one to take CVs."
							: `${change(activeRoles.change, "last month")} opened`}
					</dd>
				</div>
				<div className={kpiCard}>
					<dt className={kpiLabel}>CVs screened</dt>
					<dd className={kpiValue}>{formatNumber(cvsScreened.value)}</dd>
					<dd className={kpiNote}>
						{cvsScreened.value === 0
							? "Scored CVs are counted here."
							: change(cvsScreened.thisMonth - cvsScreened.lastMonth, "last month")}
					</dd>
				</div>
				<div className={kpiCard}>
					<dt className={kpiLabel}>Avg. time to shortlist</dt>
					<dd className={kpiValue}>{avgTimeToShortlist.hours === null ? "—" : hoursText(avgTimeToShortlist.hours)}</dd>
					<dd className={kpiNote}>{shortlistChange(avgTimeToShortlist)}</dd>
				</div>
				<div className={kpiCard}>
					<dt className={kpiLabel}>Top match</dt>
					{topMatch ? (
						<>
							<dd className="mt-3 text-[40px]">
								<ScoreRing score={topMatch.score} className="text-[40px]" />
							</dd>
							<dd className={kpiNote}>
								<Link
									to="/dashboard/jobs/$jobId/candidates/$candidateId"
									params={{ jobId: topMatch.jobId, candidateId: topMatch.candidateId }}
									className="font-[650] underline underline-offset-[.18em] [overflow-wrap:anywhere]"
								>
									{topMatch.candidateName}
								</Link>
								<span className="text-ink-muted"> for </span>
								<Link
									to="/dashboard/jobs/$jobId"
									params={{ jobId: topMatch.jobId }}
									className="underline underline-offset-[.18em] [overflow-wrap:anywhere]"
								>
									{topMatch.jobTitle}
								</Link>
							</dd>
						</>
					) : (
						<>
							<dd className={kpiValue}>—</dd>
							<dd className={kpiNote}>The best scored CV shows here.</dd>
						</>
					)}
				</div>
			</dl>
		</section>
	);
}

function Activity({ events }: { events: ActivityEvent[] }) {
	// Relative times stay true while the page is open.
	const now = useNow(60_000);
	return (
		<div>
			{events.length === 0 ? (
				<CardEmpty>Nothing has happened yet. Post a job and upload CVs, and each step shows here.</CardEmpty>
			) : (
				<ul>
					{events.map((event, index) => (
						<li key={`${event.type}-${event.at}-${index}`} className="border-b border-line-2 last:border-b-0">
							<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
								<EventText event={event} />
								<time dateTime={event.at} className="font-mono text-[12px] text-ink-muted">
									{formatRelative(event.at, now)}
								</time>
							</div>
						</li>
					))}
				</ul>
			)}
			<Link to="/dashboard" className="btn ghost mt-4">
				View all jobs <ArrowRight />
			</Link>
		</div>
	);
}

// Each event links to its candidate, else its job. A description rewrite has neither.
function EventText({ event }: { event: ActivityEvent }) {
	const cls = "min-w-0 text-[15px] [overflow-wrap:anywhere] hover:underline hover:underline-offset-[.18em]";
	if (event.jobId && event.candidateId) {
		return (
			<Link to="/dashboard/jobs/$jobId/candidates/$candidateId" params={{ jobId: event.jobId, candidateId: event.candidateId }} className={cls}>
				{event.text}
			</Link>
		);
	}
	if (event.jobId) {
		return (
			<Link to="/dashboard/jobs/$jobId" params={{ jobId: event.jobId }} className={cls}>
				{event.text}
			</Link>
		);
	}
	return <p className="min-w-0 text-[15px]">{event.text}</p>;
}
