import type { CSSProperties } from "react";
import { formatDayMonth, formatNumber } from "../lib/format.ts";
import type { FunnelCounts, OverviewAiMix, OverviewVelocity } from "../lib/overview.ts";
import { CardEmpty, LABEL } from "./card.tsx";
import { plural } from "./plural.ts";

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));
const PLOT_HEIGHT = "h-[132px]";

// CVs uploaded per day (UTC) for the days the API sends, as bars. It's drawn in HTML rather than a scaled SVG so the
// mono labels stay 11px however narrow the column is. The busiest day is the one value to notice: marker fill with an
// ink outline and its count written above it (design system §4: charts). The figure's label states the result, and
// the table underneath has every day for screen readers.
export function VelocityChart({ velocity }: { velocity: OverviewVelocity }) {
	const { days } = velocity;
	const total = days.reduce((sum, day) => sum + day.uploaded, 0);
	const max = Math.max(0, ...days.map((day) => day.uploaded));
	// Ticks at 0, half and top; the top is at least 4 and a multiple of 4, so the half is a whole number.
	const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
	const busiest = max > 0 ? days.findIndex((day) => day.uploaded === max) : -1;
	const columns: CSSProperties = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

	return (
		<div>
			<div className="flex items-baseline justify-between gap-4">
				<h3 className={LABEL}>CVs uploaded per day</h3>
				<p className="flex-none font-mono text-[12.5px] text-ink-muted">
					{total > 0 && <span className="text-[15px] font-[650] text-ink tabular-nums">{formatNumber(total)} </span>}
					{total > 0 ? "in" : "Last"} {days.length} days
				</p>
			</div>
			{total === 0 ? (
				<div className="mt-3">
					<CardEmpty>
						No CVs uploaded in the last {days.length} days. Share a job's apply link or upload CVs, and they appear here.
					</CardEmpty>
				</div>
			) : (
				<figure className="mt-7">
					<div
						role="img"
						aria-label={`CVs uploaded per day over the last ${days.length} days: ${plural(total, "CV", "CVs")} in total, the most on ${formatDayMonth(days[busiest].date)} with ${max}. The same figures are in the table below.`}
						className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"
					>
						<div className={`relative ${PLOT_HEIGHT} w-5 font-mono text-[11px] leading-none text-ink-muted`}>
							{[top, top / 2, 0].map((tick, index) => (
								<span key={tick} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${index * 50}%` }}>
									{tick}
								</span>
							))}
						</div>
						<div className={`relative ${PLOT_HEIGHT} border-b border-line`}>
							<span className="absolute inset-x-0 top-0 border-t border-line-2" />
							<span className="absolute inset-x-0 top-1/2 border-t border-line-2" />
							<div className="absolute inset-0 grid gap-[3px]" style={columns}>
								{days.map((day, index) => {
									const label = `${formatDayMonth(day.date)}: ${plural(day.uploaded, "CV", "CVs")} uploaded`;
									const isBusiest = index === busiest;
									return (
										<div key={day.date} className="relative flex items-end justify-center">
											{day.uploaded > 0 && (
												<span
													title={label}
													className={`relative block w-full max-w-[22px] rounded-t-[3px] ${isBusiest ? "border-[1.5px] border-b-0 border-ink bg-marker" : "bg-ink"}`}
													style={{ height: `max(${(day.uploaded / top) * 100}%, 2px)` }}
												>
													{isBusiest && (
														<span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 font-mono text-[11px] leading-none font-[650] text-ink tabular-nums">
															{day.uploaded}
														</span>
													)}
												</span>
											)}
										</div>
									);
								})}
							</div>
						</div>
						<span />
						<div className="mt-1.5 grid gap-[3px] font-mono text-[11px] leading-[1.25] text-ink-muted" style={columns}>
							{days.map((day, index) => {
								const [dayNumber, month] = formatDayMonth(day.date).split(" ");
								// The month goes under the first bar and under the 1st of a month.
								const showMonth = index === 0 || day.date.endsWith("-01");
								return (
									<span key={day.date} className="flex flex-col items-center tabular-nums">
										{dayNumber}
										{showMonth && <span>{month}</span>}
									</span>
								);
							})}
						</div>
					</div>
					<table className="sr-only">
						<caption>CVs uploaded per day, last {days.length} days (UTC)</caption>
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
				</figure>
			)}
		</div>
	);
}

// Received, scored and shortlisted over 90 days, each bar as wide as its share of the CVs received, with the
// conversion written beside it. Shortlisted is the number to notice, so it gets the marker with an ink outline.
export function Funnel({ funnel }: { funnel: FunnelCounts }) {
	const steps = [
		{ label: "Received", value: funnel.received, note: "CVs uploaded" },
		{ label: "Scored", value: funnel.scored, note: `${percent(funnel.scored, funnel.received)}% of received` },
		{ label: "Shortlisted", value: funnel.shortlisted, note: `${percent(funnel.shortlisted, funnel.scored)}% of scored` },
	];
	return (
		<div>
			<h3 className={LABEL}>Funnel · last 90 days</h3>
			{funnel.received === 0 ? (
				<div className="mt-3">
					<CardEmpty>Upload CVs to a job and the funnel fills in as they are read and shortlisted.</CardEmpty>
				</div>
			) : (
				<ol className="mt-3 flex flex-col gap-3.5">
					{steps.map((step) => (
						<li key={step.label}>
							<div className="flex flex-wrap items-baseline justify-between gap-x-4">
								<p className="text-[15px] font-[650]">{step.label}</p>
								<p className="font-mono text-[12.5px] text-ink-muted">
									<span className="text-[15px] font-[650] text-ink tabular-nums">{formatNumber(step.value)}</span> · {step.note}
								</p>
							</div>
							<div className="mt-1.5 h-2.5 rounded-[4px] bg-line-2" aria-hidden="true">
								<div
									className={`h-full rounded-[4px] ${step.label === "Shortlisted" ? "border-[1.5px] border-ink bg-marker" : "bg-ink"}`}
									style={{ width: `${percent(step.value, funnel.received)}%`, minWidth: step.value > 0 ? 6 : 0 }}
								/>
							</div>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

// What the AI wrote in 90 days, as one stacked bar with the count and share named under it. The words and numbers
// carry the meaning; the swatches only tie each row to its part of the bar.
export function AiMix({ mix }: { mix: OverviewAiMix }) {
	const rows = [
		{ label: "CV scoring", value: mix.scoring, swatch: "bg-ink" },
		{ label: "Description rewrites", value: mix.descriptionRewrites, swatch: "bg-ink-muted" },
		{ label: "Interview questions", value: mix.interviewQuestions, swatch: "border-[1.5px] border-ink bg-sheet" },
	];
	const total = rows.reduce((sum, row) => sum + row.value, 0);
	if (total === 0) {
		return <CardEmpty>Nothing written yet. Scored CVs, rewritten descriptions and interview questions show here.</CardEmpty>;
	}

	return (
		<div>
			<div className="flex h-3 gap-[3px]" aria-hidden="true">
				{rows
					.filter((row) => row.value > 0)
					.map((row) => (
						<i
							key={row.label}
							className={`block h-full min-w-1.5 rounded-[3px] ${row.swatch}`}
							style={{ width: `${(row.value / total) * 100}%` }}
						/>
					))}
			</div>
			<ul className="mt-4 flex flex-col gap-2">
				{rows.map((row) => (
					<li key={row.label} className="flex items-center justify-between gap-4 text-[15px]">
						<span className="inline-flex min-w-0 items-center gap-2.5">
							<i className={`size-3 flex-none rounded-[3px] ${row.swatch}`} aria-hidden="true" />
							{row.label}
						</span>
						<span className="flex-none font-mono text-[12.5px] text-ink-muted">
							<span className="text-[15px] font-[650] text-ink tabular-nums">{formatNumber(row.value)}</span> ·{" "}
							{percent(row.value, total)}%
						</span>
					</li>
				))}
			</ul>
			<p className="mt-4 font-mono text-[12px] text-ink-muted">Successful calls, last 90 days</p>
		</div>
	);
}
