// The loop the landing page draws around its one score (design system §3). Use one per screen.
const RING_PATH = "M118 14C92 2 40 4 18 30 2 50 6 92 40 112c34 18 92 10 110-22 14-28 0-64-38-78-12-4-24-4-34-2";

// A score in condensed numerals with the ink ring around it. The ring takes the text colour and scales
// with the font size, so set both with `className`.
export function ScoreRing({ score, className = "" }: { score: number; className?: string }) {
	return (
		<span
			className={`score-ring font-display leading-[.86] font-[800] tracking-[-0.02em] tabular-nums [font-stretch:62%] ${className}`}
		>
			{score}
			<svg viewBox="0 0 160 130" preserveAspectRatio="none" aria-hidden="true">
				<path pathLength="1" d={RING_PATH} />
			</svg>
		</span>
	);
}
