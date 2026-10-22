// Glyphs drawn the way the prototype draws them (design system §4: icons).
export function ArrowRight() {
	return (
		<svg className="arr" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M3 9h11M10 4.5 14.5 9 10 13.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function Check() {
	return (
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<path
				d="M2.5 8.5 6 12l7.5-8"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
