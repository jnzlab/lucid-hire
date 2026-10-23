import type { ReactNode } from "react";

// One number with its label and what changed: "CVs SCREENED · 112 · 18 more than last month". The value is in
// condensed score numerals; the change line is mono and always in words, so colour is never the only signal.
export function StatTile({
	label,
	value,
	unit,
	change,
	trend,
	className = "",
}: {
	label: ReactNode;
	value: ReactNode;
	// A small word after the value: "h", "days".
	unit?: ReactNode;
	// The change line: "18 more than last month".
	change?: ReactNode;
	// Draws ↑ or ↓ before the change line. The words still have to say it.
	trend?: "up" | "down" | "flat";
	className?: string;
}) {
	return (
		<div className={`flex min-w-0 flex-col gap-2 rounded-xl bg-sheet p-5 shadow-card ${className}`}>
			<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{label}</p>
			<p className="flex items-baseline gap-1.5">
				<span className="font-display text-[52px] leading-[.9] font-[800] tracking-[-0.02em] text-ink tabular-nums [font-stretch:62%]">
					{value}
				</span>
				{unit && <span className="font-mono text-[13px] text-ink-muted">{unit}</span>}
			</p>
			{change && (
				<p className="font-mono text-[12.5px] leading-[1.4] text-ink-muted">
					{trend === "up" && <span aria-hidden="true">↑ </span>}
					{trend === "down" && <span aria-hidden="true">↓ </span>}
					{change}
				</p>
			)}
		</div>
	);
}
