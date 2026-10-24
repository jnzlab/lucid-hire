// "↑2" on a marker or "↓1" in gap ink beside a CV that just moved in a re-rank (design system §9.5). It fades once
// `fresh` goes; the rank number says the same thing for good, so it is hidden from screen readers.
export function MoveMark({ move, fresh }: { move: number | undefined; fresh: boolean }) {
	if (!move) return null;
	return (
		<span
			aria-hidden="true"
			className={`inline-block flex-none rounded-[2px] px-[3px] font-mono text-[11px] leading-[1.35] tabular-nums transition-opacity duration-300 ${fresh ? "opacity-100" : "opacity-0"} ${move > 0 ? "bg-marker text-on-marker" : "text-gap-ink"}`}
		>
			{move > 0 ? "↑" : "↓"}
			{Math.abs(move)}
		</span>
	);
}
