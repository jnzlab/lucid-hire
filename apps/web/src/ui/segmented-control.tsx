import type { ReactNode } from "react";
import { Check } from "../components/icons.tsx";

export type Segment<T extends string> = {
	value: T;
	label: ReactNode;
	// How the chosen segment is drawn: on the yellow marker for a match, on the pink one for a no. `ink` (filled in
	// ink, like the primary button) and `marker` (yellow, no glyph) rank choices by strength, as Must and Nice do.
	mark?: "yes" | "no" | "ink" | "marker";
};

const CHOSEN = {
	plain: "border-ink bg-sheet text-ink shadow-card",
	yes: "border-ink bg-marker text-on-marker",
	no: "border-ink bg-gap text-on-marker",
	ink: "border-ink bg-ink text-paper",
	marker: "border-ink bg-marker text-on-marker",
};

// A row of real radio buttons drawn as one segmented control (design system §4: chip or toggle), so the arrow
// keys, the single tab stop and the screen reader's "1 of 3" all come from the browser. The chosen segment has an
// ink border as well as its fill, and the yes and no marks add a glyph, so colour is never the only signal.
export function SegmentedControl<T extends string>({
	name,
	labelledBy,
	value,
	segments,
	onChange,
	compact = false,
	className = "",
}: {
	name: string;
	// The id of the element that names the group.
	labelledBy: string;
	value: T;
	segments: Segment<T>[];
	onChange: (value: T) => void;
	compact?: boolean;
	className?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-labelledby={labelledBy}
			className={`inline-flex flex-wrap gap-1 rounded-lg border border-line bg-paper-2 p-1 ${className}`}
		>
			{segments.map((segment) => {
				const chosen = segment.value === value;
				return (
					<label key={segment.value} className="relative block">
						<input
							type="radio"
							name={name}
							value={segment.value}
							checked={chosen}
							onChange={() => onChange(segment.value)}
							className="peer sr-only"
						/>
						<span
							className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border-[1.5px] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${compact ? "px-3 font-mono text-[12.5px]" : "px-4 text-[14px] font-semibold"} ${chosen ? CHOSEN[segment.mark ?? "plain"] : "border-transparent text-ink-muted hover:text-ink"}`}
						>
							{chosen && segment.mark === "yes" && <Check />}
							{chosen && segment.mark === "no" && <span aria-hidden="true">✕</span>}
							{segment.label}
						</span>
					</label>
				);
			})}
		</div>
	);
}
