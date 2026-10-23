import type { Decision } from "../lib/candidates.ts";

// The words for each decision everywhere in the UI. The stored value for "Not a fit" is `rejected`.
const LABEL: Record<Decision, string> = { shortlisted: "Shortlisted", rejected: "Not a fit", undecided: "Undecided" };
const LOOK: Record<Decision, string> = {
	shortlisted: "border-ink bg-marker text-on-marker",
	rejected: "border-ink bg-gap text-on-marker",
	undecided: "border-line bg-sheet text-ink-muted",
};

// The recruiters' call beside a name: "Shortlisted" on the yellow marker, "Not a fit" on the pink one, each in words
// and with an ink border, because yellow alone barely shows on a sheet or on the top row's marker stroke. Nothing
// for an undecided CV unless `showUndecided`.
export function DecisionTag({
	decision,
	showUndecided = false,
	className = "",
}: {
	decision: Decision;
	showUndecided?: boolean;
	className?: string;
}) {
	if (decision === "undecided" && !showUndecided) return null;
	return (
		<span
			className={`inline-flex min-h-6 flex-none items-center rounded-md border-[1.5px] px-2 font-mono text-[12px] leading-none whitespace-nowrap ${LOOK[decision]} ${className}`}
		>
			<span className="sr-only">Decision:</span>{" "}
			{LABEL[decision]}
		</span>
	);
}
