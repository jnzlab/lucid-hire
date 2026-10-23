import { type ReactNode, useId } from "react";

// How much of an allowance is used: "Jobs this month · 3 of 10". An 8px `line` track filled in ink; from 90% the fill
// turns gap-ink and a sentence says so, so colour is never the only signal.
export function Meter({
	label,
	value,
	max,
	valueText,
	warning,
	hideLabel = false,
	compact = false,
	className = "",
}: {
	label: ReactNode;
	value: number;
	max: number;
	// The amount in words; defaults to "3 of 10".
	valueText?: string;
	// What to say at 90% and over; defaults to "Almost at the limit" / "Limit reached".
	warning?: ReactNode;
	hideLabel?: boolean;
	// The sidebar's size: 12.5px mono label and value on one line.
	compact?: boolean;
	className?: string;
}) {
	const labelId = useId();
	const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
	const high = ratio >= 0.9;
	const text = valueText ?? `${value} of ${max}`;
	const warn = warning ?? (value >= max ? "Limit reached" : "Almost at the limit");
	return (
		<div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"} ${className}`}>
			<div className={`flex items-baseline justify-between gap-3 ${hideLabel ? "sr-only" : ""}`}>
				<span id={labelId} className={compact ? "font-mono text-[12.5px] text-ink-muted" : "text-[14px] font-semibold text-ink"}>
					{label}
				</span>
				<span className={`font-mono tabular-nums ${compact ? "text-[12.5px] text-ink-2" : "text-[13px] text-ink-muted"}`}>{text}</span>
			</div>
			<div
				role="meter"
				aria-labelledby={labelId}
				aria-valuemin={0}
				aria-valuemax={max}
				aria-valuenow={Math.min(value, max)}
				aria-valuetext={high ? `${text}. ${typeof warn === "string" ? warn : ""}`.trim() : text}
				className="meter"
			>
				<span className={`meter-fill ${high ? "is-high" : ""}`} style={{ width: `${ratio * 100}%` }} />
			</div>
			{high && (
				<p className="font-mono text-[12.5px] text-gap-ink">
					{value >= max && "✕ "}
					{warn}
				</p>
			)}
		</div>
	);
}
