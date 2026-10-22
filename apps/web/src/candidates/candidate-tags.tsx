import { DECISION_LABEL, type Decision } from "../lib/candidates.ts";

// The matches (yellow) and gaps (pink) beside a score, as the landing page's shortlist draws them
// (design system §3: evidence chips). A gap carries a ✕ and every tag is words, so colour is never the
// only signal. The sr-only labels say which is which to screen readers.
export function CandidateTags({
	matches,
	gaps,
	className = "",
}: {
	matches: string[];
	gaps: string[];
	className?: string;
}) {
	if (matches.length === 0 && gaps.length === 0) return null;
	return (
		<p className={`flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[12px] leading-[1.5] ${className}`}>
			{matches.length > 0 && <span className="sr-only">Matches:</span>}
			{matches.map((label, index) => (
				<span key={`${label}-${index}`} className="mk [overflow-wrap:anywhere]">
					{label}
				</span>
			))}
			{gaps.length > 0 && <span className="sr-only">Missing:</span>}
			{gaps.map((label, index) => (
				<span key={`${label}-${index}`} className="mk mk-gap [overflow-wrap:anywhere]">
					✕ {label}
				</span>
			))}
		</p>
	);
}

// The recruiters' call beside a name: "Shortlisted" on the yellow marker, "Rejected" on the pink one, each in
// words and with an ink border, because yellow alone barely shows on a sheet or on the top row's marker stroke.
// Nothing for a CV nobody has decided on.
export function DecisionTag({ decision, className = "" }: { decision: Decision; className?: string }) {
	if (decision === "undecided") return null;
	return (
		<span
			className={`inline-flex min-h-6 items-center rounded-md border-[1.5px] border-ink px-2 font-mono text-[12px] leading-none text-on-marker ${decision === "shortlisted" ? "bg-marker" : "bg-gap"} ${className}`}
		>
			<span className="sr-only">Decision: </span>
			{DECISION_LABEL[decision]}
		</span>
	);
}
