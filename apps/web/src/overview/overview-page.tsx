import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowRight } from "../components/icons.tsx";
import { ScoreRing } from "../components/score-ring.tsx";
import { useOrg } from "../dashboard/org.ts";
import { PageHeading, SectionLoading } from "../jobs/job-ui.tsx";
import { formatNumber, formatRelative } from "../lib/format.ts";
import {
	type ActivityEvent,
	type OverviewKpis,
	useOverviewActivity,
	useOverviewAiMix,
	useOverviewFunnel,
	useOverviewKpis,
	useOverviewVelocity,
} from "../lib/overview.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { useNow } from "../lib/use-now.ts";
import { AiMix, CardEmpty, Funnel, VelocityChart } from "./charts.tsx";

export function OverviewPage() {
	useDocumentTitle("Overview · LucidHire");
	const org = useOrg();

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
			<div className="mt-8 flex flex-col gap-6">
				<KpiRow />
				<div className="grid gap-6 min-[1000px]:grid-cols-2">
					<VelocityCard />
					<div className="flex flex-col gap-6">
						<FunnelCard />
						<AiMixCard />
					</div>
				</div>
				<ActivityCard />
			</div>
		</div>
	);
}

// What a card shows until its numbers arrive, or if they can't. Each card has its own, so the others carry on.
function CardState<T>({ query, what, children }: { query: UseQueryResult<T>; what: string; children: (data: T) => ReactNode }) {
	if (query.isPending) return <SectionLoading label={`Loading ${what}`} />;
	if (query.isError) {
		return (
			<div role="alert" className="flex flex-col items-start gap-3">
				<p className="text-[15px] text-ink-2">
					<span className="font-[650] text-gap-ink">✕ We couldn't load {what}.</span> {query.error.message}
				</p>
				<button type="button" className="btn" onClick={() => void query.refetch()}>
					Try again
				</button>
			</div>
		);
	}
	return children(query.data);
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

function VelocityCard() {
	const velocity = useOverviewVelocity();
	return (
		<Card id="velocity-h" title="Pipeline velocity">
			<CardState query={velocity} what="pipeline velocity">
				{(data) => <VelocityChart velocity={data} />}
			</CardState>
		</Card>
	);
}

function FunnelCard() {
	const funnel = useOverviewFunnel();
	return (
		<Card id="funnel-h" title="90-day funnel">
			<CardState query={funnel} what="the funnel">
				{(data) => <Funnel funnel={data} />}
			</CardState>
		</Card>
	);
}

function AiMixCard() {
	const mix = useOverviewAiMix();
	return (
		<Card id="mix-h" title="AI output mix">
			<CardState query={mix} what="the AI output mix">
				{(data) => <AiMix mix={data} />}
			</CardState>
		</Card>
	);
}

function ActivityCard() {
	const activity = useOverviewActivity();
	return (
		<Card id="activity-h" title="Recent activity">
			<CardState query={activity} what="recent activity">
				{(data) => <Activity events={data.events} />}
			</CardState>
		</Card>
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

function shortlistChange({ hours, previousHours }: OverviewKpis["avgTimeToShortlist"]) {
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

function KpiRow() {
	const kpis = useOverviewKpis();
	return (
		<section aria-label="Key numbers">
			<CardState query={kpis} what="your key numbers">
				{(data) => <KpiCards kpis={data} />}
			</CardState>
		</section>
	);
}

function KpiCards({ kpis }: { kpis: OverviewKpis }) {
	const { activeRoles, cvsScreened, avgTimeToShortlist, topMatch } = kpis;
	return (
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
			<Link to="/dashboard/jobs" className="btn ghost mt-4">
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
