// A small count beside a nav item, tab or filter: "8". `marker` is for things waiting on you (to review), with an
// ink outline because yellow alone barely shows on paper. `label` finishes the sentence for screen readers
// ("8 to review"). Nothing renders at zero unless `showZero`.
export function CountBadge({
	count,
	variant = "plain",
	label,
	showZero = false,
	className = "",
}: {
	count: number;
	variant?: "plain" | "marker";
	label?: string;
	showZero?: boolean;
	className?: string;
}) {
	if (count === 0 && !showZero) return null;
	return (
		<span className={`count-badge ${variant === "marker" ? "count-badge-marker" : ""} ${className}`}>
			{count > 999 ? "999+" : count}
			{label && <span className="sr-only"> {label}</span>}
		</span>
	);
}
