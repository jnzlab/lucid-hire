// Grey bars standing in for content that is loading, like the lines on the hero's sheets (design system §4). They
// don't animate (nothing loops but the live dot). Pass `label` on the outermost skeleton of a card so screen
// readers hear that it is loading; the bars themselves are hidden from them.
export function Skeleton({
	lines = 1,
	className = "",
	label,
}: {
	// Several bars of falling width, like a paragraph.
	lines?: number;
	// Size the bar(s) here: "h-4 w-40".
	className?: string;
	label?: string;
}) {
	const bars = Array.from({ length: lines }, (_, index) => (
		<span
			key={index}
			aria-hidden="true"
			className={`skeleton block ${lines > 1 && index === lines - 1 ? "w-3/5" : ""} ${className}`}
		/>
	));
	if (!label) return lines > 1 ? <span className="flex flex-col gap-2">{bars}</span> : bars[0];
	return (
		<span role="status" className="flex flex-col gap-2">
			<span className="sr-only">{label}</span>
			{bars}
		</span>
	);
}
