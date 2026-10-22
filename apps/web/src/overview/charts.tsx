import { useId } from "react";
import { formatDayMonth, formatNumber } from "../lib/format.ts";
import type { FunnelCounts, OverviewAiMix, OverviewVelocity } from "../lib/overview.ts";

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

// Plain-sentence empty state inside a card.
export function CardEmpty({ children }: { children: string }) {
	return <p className="rounded-md bg-paper px-4 py-5 text-[15px] text-ink-2">{children}</p>;
}

// 90-day totals under the velocity chart.
function Totals({ totals }: { totals: FunnelCounts }) {
	return (
		<dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line-2 pt-4">
			{(
				[
					["Received", totals.received],
					["Scored", totals.scored],
					["Shortlisted", totals.shortlisted],
				] as const
			).map(([label, value]) => (
				<div key={label}>
					<dt className="font-mono text-[11px] tracking-[.08em] text-ink-muted uppercase">{label}</dt>
					<dd className="mt-1 font-display text-[28px] leading-none font-[800] tracking-[-0.02em] tabular-nums [font-stretch:108%]">
						{formatNumber(value)}
					</dd>
				</div>
			))}
			<p className="col-span-3 font-mono text-[12px] text-ink-muted">Last 90 days</p>
		</dl>
	);
}

const W = 420;
const H = 220;
const PLOT = { left: 36, right: 6, top: 14, bottom: 44 };

// CVs uploaded per day for the last 10 UTC days. The busiest day is the one value to notice, so it is marked
// yellow with an ink outline; every bar has a title, and the table underneath is the same data for screen readers.
export function VelocityChart({ velocity }: { velocity: OverviewVelocity }) {
	const captionId = useId();
	const { days, totals } = velocity;
	const max = Math.max(...days.map((day) => day.uploaded));
	const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
	const plotW = W - PLOT.left - PLOT.right;
	const plotH = H - PLOT.top - PLOT.bottom;
	const slot = plotW / days.length;
	const barW = Math.min(26, slot - 8);
	const y = (value: number) => PLOT.top + plotH - (value / top) * plotH;
	const busiest = max > 0 ? days.findIndex((day) => day.uploaded === max) : -1;
	const uploadedInTotal = days.reduce((sum, day) => sum + day.uploaded, 0);

	return (
		<div>
			{uploadedInTotal === 0 && <CardEmpty>No CVs uploaded in the last 10 days. Upload some to a job and they appear here.</CardEmpty>}
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-labelledby={captionId}
				className={`mt-3 block h-auto w-full max-w-[560px] ${uploadedInTotal === 0 ? "opacity-60" : ""}`}
			>
				<title id={captionId}>CVs uploaded per day over the last 10 days. The same figures are in the table below.</title>
				{[0, top / 2, top].map((tick) => (
					<g key={tick}>
						<line x1={PLOT.left} x2={W - PLOT.right} y1={y(tick)} y2={y(tick)} className="stroke-line-2" strokeWidth="1" />
						<text x={PLOT.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" className="fill-ink-muted font-mono">
							{tick}
						</text>
					</g>
				))}
				<text
					x={10}
					y={PLOT.top + plotH / 2}
					textAnchor="middle"
					fontSize="11"
					transform={`rotate(-90 10 ${PLOT.top + plotH / 2})`}
					className="fill-ink-muted font-mono"
				>
					CVs uploaded
				</text>
				{days.map((day, index) => {
					const x = PLOT.left + slot * index + (slot - barW) / 2;
					const height = (day.uploaded / top) * plotH;
					const label = formatDayMonth(day.date);
					const showMonth = index === 0 || day.date.endsWith("-01");
					const [dayNumber, month] = label.split(" ");
					return (
						<g key={day.date}>
							<rect
								x={x}
								y={y(day.uploaded)}
								width={barW}
								height={Math.max(height, day.uploaded > 0 ? 2 : 0)}
								rx="2"
								strokeWidth="1.5"
								className={index === busiest ? "fill-marker stroke-ink" : "fill-ink stroke-transparent"}
							>
								<title>{`${label}: ${day.uploaded} ${day.uploaded === 1 ? "CV" : "CVs"} uploaded`}</title>
							</rect>
							<text x={x + barW / 2} y={H - PLOT.bottom + 16} textAnchor="middle" fontSize="11" className="fill-ink-muted font-mono">
								{dayNumber}
							</text>
							{showMonth && (
								<text x={x + barW / 2} y={H - PLOT.bottom + 29} textAnchor="middle" fontSize="11" className="fill-ink-muted font-mono">
									{month}
								</text>
							)}
						</g>
					);
				})}
				<text x={PLOT.left + plotW / 2} y={H - 3} textAnchor="middle" fontSize="11" className="fill-ink-muted font-mono">
					Day (UTC)
				</text>
			</svg>
			<table className="sr-only">
				<caption>CVs uploaded per day, last 10 days (UTC)</caption>
				<thead>
					<tr>
						<th scope="col">Day</th>
						<th scope="col">CVs uploaded</th>
					</tr>
				</thead>
				<tbody>
					{days.map((day) => (
						<tr key={day.date}>
							<th scope="row">{formatDayMonth(day.date)}</th>
							<td>{day.uploaded}</td>
						</tr>
					))}
				</tbody>
			</table>
			<Totals totals={totals} />
		</div>
	);
}

// Received, scored and shortlisted as bars, each as wide as its share of the CVs received.
export function Funnel({ funnel }: { funnel: FunnelCounts }) {
	if (funnel.received === 0) {
		return <CardEmpty>Upload CVs to a job and the funnel fills in as they are read and shortlisted.</CardEmpty>;
	}
	const steps = [
		{ label: "Received", value: funnel.received, note: "CVs uploaded" },
		{ label: "Scored", value: funnel.scored, note: `${percent(funnel.scored, funnel.received)}% of received` },
		{ label: "Shortlisted", value: funnel.shortlisted, note: `${percent(funnel.shortlisted, funnel.scored)}% of scored` },
	];
	return (
		<ol className="flex flex-col gap-4">
			{steps.map((step) => (
				<li key={step.label}>
					<div className="flex items-baseline justify-between gap-4">
						<p className="text-[15px] font-[650]">{step.label}</p>
						<p className="font-mono text-[12.5px] text-ink-muted">
							<span className="text-[15px] font-[650] text-ink tabular-nums">{formatNumber(step.value)}</span> · {step.note}
						</p>
					</div>
					<div className="mt-1.5 h-3 rounded-[4px] bg-line-2" aria-hidden="true">
						<div
							className={`h-full min-w-1 rounded-[4px] ${step.label === "Shortlisted" ? "border-[1.5px] border-ink bg-marker" : "bg-ink"}`}
							style={{ width: `${percent(step.value, funnel.received)}%`, minWidth: step.value > 0 ? 4 : 0 }}
						/>
					</div>
				</li>
			))}
		</ol>
	);
}

// One stacked bar and a labelled count per kind of AI output. The counts, not the colours, carry the meaning.
export function AiMix({ mix }: { mix: OverviewAiMix }) {
	const rows = [
		{ label: "CV scoring", value: mix.scoring, swatch: "bg-ink" },
		{ label: "Description rewrites", value: mix.descriptionRewrites, swatch: "bg-ink-faint" },
		{ label: "Interview questions", value: mix.interviewQuestions, swatch: "border-[1.5px] border-ink bg-marker" },
	];
	const total = rows.reduce((sum, row) => sum + row.value, 0);
	if (total === 0) return <CardEmpty>Nothing written yet. Scored CVs, rewritten descriptions and interview questions show here.</CardEmpty>;

	return (
		<div>
			<div className="flex h-3 gap-0.5 overflow-hidden rounded-[4px] bg-line-2" aria-hidden="true">
				{rows
					.filter((row) => row.value > 0)
					.map((row) => (
						<i key={row.label} className={`block h-full ${row.swatch}`} style={{ width: `${(row.value / total) * 100}%` }} />
					))}
			</div>
			<ul className="mt-4 flex flex-col gap-2">
				{rows.map((row) => (
					<li key={row.label} className="flex items-center justify-between gap-4 text-[15px]">
						<span className="inline-flex items-center gap-2.5">
							<i className={`size-3 flex-none rounded-[3px] ${row.swatch}`} aria-hidden="true" />
							{row.label}
						</span>
						<span className="font-mono text-[13px] text-ink-muted">
							<span className="text-[15px] font-[650] text-ink tabular-nums">{formatNumber(row.value)}</span> · {percent(row.value, total)}%
						</span>
					</li>
				))}
			</ul>
			<p className="mt-4 font-mono text-[12px] text-ink-muted">Successful calls, last 90 days</p>
		</div>
	);
}
