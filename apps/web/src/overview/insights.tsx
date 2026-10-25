import { Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { useNow } from "../lib/use-now.ts";
import { Skeleton } from "../ui/skeleton.tsx";
import { StatTile } from "../ui/stat-tile.tsx";
import { CARD, CardEmpty, CardState, Section } from "./card.tsx";
import { AiMix, Funnel, VelocityChart } from "./charts.tsx";

// How many events the activity card lists before "Show all".
const ACTIVITY_SHOWN = 5;

// The overview's right column: how hiring is going, under the work queue on narrow screens. It's its own container,
// so as a full-width column (below 880px of page) the cards sit two-up and the key numbers three-up, and in the
// narrow right column everything stacks.
export function Insights() {
	return (
		<div className="@container min-w-0">
			<div className="grid gap-10 @min-[600px]:grid-cols-2 @min-[600px]:gap-x-6">
				<KeyNumbers className="@min-[600px]:col-span-2" />
				<Pipeline />
				<div className="flex min-w-0 flex-col gap-10">
					<AiUsage />
					<RecentActivity />
				</div>
			</div>
		</div>
	);
}

// "+3 vs last month" (or "+3 opened vs last month"), in words as well as a sign, so it never depends on colour. The
// minus is a real minus sign.
function change(delta: number, noun: string, verb?: string) {
	if (delta === 0) return `No change vs ${noun}`;
	return `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}${verb ? ` ${verb}` : ""} vs ${noun}`;
}

const trend = (delta: number) => (delta > 0 ? "up" : delta < 0 ? "down" : undefined);

function awaitingChange({ value, scoredThisWeek }: OverviewKpis["awaitingDecision"]) {
	if (value === 0) return "Nothing waiting. Scored CVs land here.";
	return (
		<>
			{formatNumber(scoredThisWeek)} scored this week · <span className="underline-offset-[.18em] group-hover:underline">Review</span>
			<span aria-hidden="true"> →</span>
		</>
	);
}

// Open roles, CVs screened and the CVs waiting on a decision. Named "Key numbers" rather than "This month" because
// they aren't all monthly: open roles and the CVs waiting are now, and CVs screened are all time.
function KeyNumbers({ className }: { className: string }) {
	const kpis = useOverviewKpis();
	return (
		<Section title="Key numbers" className={className}>
			<CardState
				query={kpis}
				what="your key numbers"
				loading={(label) => (
					<div role="status" className="grid gap-3 @min-[560px]:grid-cols-3">
						<span className="sr-only">{label}</span>
						{[0, 1, 2].map((index) => (
							<div key={index} className={`${CARD} flex flex-col gap-3 p-5`} aria-hidden="true">
								<Skeleton className="h-3 w-24" />
								<Skeleton className="h-10 w-16" />
								<Skeleton className="h-3 w-36" />
							</div>
						))}
					</div>
				)}
			>
				{({ activeRoles, cvsScreened, awaitingDecision }) => {
					const screenedDelta = cvsScreened.thisMonth - cvsScreened.lastMonth;
					return (
						<div className="grid gap-3 @min-[560px]:grid-cols-3">
							<StatTile
								label="Active roles"
								value={formatNumber(activeRoles.value)}
								change={
									activeRoles.value === 0 && activeRoles.change === 0
										? "No open jobs. Open one to take CVs."
										: change(activeRoles.change, "last month", "opened")
								}
								trend={trend(activeRoles.change)}
							/>
							<StatTile
								label="CVs screened"
								value={formatNumber(cvsScreened.value)}
								change={cvsScreened.value === 0 ? "Scored CVs are counted here." : change(screenedDelta, "last month")}
								trend={cvsScreened.value === 0 ? undefined : trend(screenedDelta)}
							/>
							{/* The whole card opens the candidates page at "To review", which lists exactly these CVs. */}
							<Link to="/dashboard/candidates" search={{ decision: "review" }} className="group flex rounded-xl">
								<StatTile
									className="w-full"
									label="Awaiting a decision"
									value={formatNumber(awaitingDecision.value)}
									change={awaitingChange(awaitingDecision)}
								/>
							</Link>
						</div>
					);
				}}
			</CardState>
		</Section>
	);
}

// Uploads per day and the 90-day funnel in one card. They're two queries, so each half loads and fails on its own.
function Pipeline() {
	const velocity = useOverviewVelocity();
	const funnel = useOverviewFunnel();
	return (
		<Section title="Pipeline">
			<div className={`${CARD} flex flex-col p-5`}>
				<CardState
					query={velocity}
					what="pipeline velocity"
					loading={(label) => <Skeleton className="h-36 w-full" label={label} />}
				>
					{(data) => <VelocityChart velocity={data} />}
				</CardState>
				<div className="mt-6 border-t border-line-2 pt-5">
					<CardState query={funnel} what="the funnel">
						{(data) => <Funnel funnel={data} />}
					</CardState>
				</div>
			</div>
		</Section>
	);
}

function AiUsage() {
	const mix = useOverviewAiMix();
	return (
		<Section title="AI usage">
			<div className={`${CARD} p-5`}>
				<CardState query={mix} what="AI usage">
					{(data) => <AiMix mix={data} />}
				</CardState>
			</div>
		</Section>
	);
}

function RecentActivity() {
	const activity = useOverviewActivity();
	return (
		<Section title="Recent activity">
			<div className={`${CARD} p-5`}>
				<CardState query={activity} what="recent activity">
					{(data) => <Timeline events={data.events} />}
				</CardState>
			</div>
		</Section>
	);
}

// The latest events, newest first, on a thin line: when (mono) over what happened. The first five show; "Show all"
// opens the rest of what the API sent.
function Timeline({ events }: { events: ActivityEvent[] }) {
	// Relative times stay true while the page is open.
	const now = useNow(60_000);
	const [expanded, setExpanded] = useState(false);
	if (events.length === 0) {
		return <CardEmpty>Nothing has happened yet. Post a job and upload CVs, and each step shows here.</CardEmpty>;
	}
	const shown = expanded ? events : events.slice(0, ACTIVITY_SHOWN);

	return (
		<div>
			<ol>
				{shown.map((event, index) => (
					<li
						key={`${event.type}-${event.at}-${index}`}
						className="relative grid grid-cols-[10px_minmax(0,1fr)] gap-x-3.5 pb-4 last:pb-0 before:absolute before:top-[17px] before:bottom-0.5 before:left-[4.5px] before:w-px before:bg-line last:before:hidden"
					>
						<span
							aria-hidden="true"
							className={`mt-[5px] size-2 justify-self-center rounded-full ${event.type === "cv_failed" ? "bg-gap-ink" : "bg-ink"}`}
						/>
						<div className="min-w-0">
							<time dateTime={event.at} className="block font-mono text-[12px] leading-[1.4] text-ink-muted">
								{formatRelative(event.at, now)}
							</time>
							<EventText event={event} />
						</div>
					</li>
				))}
			</ol>
			{events.length > ACTIVITY_SHOWN && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((was) => !was)}
					className="mt-3 inline-flex min-h-11 items-center font-mono text-[12.5px] text-ink-2 underline underline-offset-[.18em] hover:text-ink"
				>
					{expanded ? "Show fewer" : `Show all ${events.length}`}
				</button>
			)}
		</div>
	);
}

// Each event links to its candidate, else its job. A description rewrite has neither.
function EventText({ event }: { event: ActivityEvent }) {
	const cls = "text-[15px] leading-[1.45] [overflow-wrap:anywhere] hover:underline hover:underline-offset-[.18em]";
	if (event.jobId && event.candidateId) {
		return (
			<Link
				to="/dashboard/jobs/$jobId/candidates/$candidateId"
				params={{ jobId: event.jobId, candidateId: event.candidateId }}
				className={cls}
			>
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
	return <p className="text-[15px] leading-[1.45] [overflow-wrap:anywhere]">{event.text}</p>;
}
