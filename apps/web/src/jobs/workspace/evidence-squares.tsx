import type { Check, EvidenceLevel } from "@lucid-hire/scoring";
import { squareLabel } from "../../lib/rubric.ts";

const SIZE = { sm: "size-3", md: "size-3.5" };

// One evidence square (design system §9.5), as the landing page's demo drew them: filled is clear, half is partial,
// empty is none, and a dotted outline is a requirement the CV hasn't been checked against yet. An Off requirement's
// square is dimmed. Without a `label` it is decoration (a legend beside its word).
export function EvidenceSquare({
	level,
	off = false,
	size = "sm",
	label,
}: {
	level: EvidenceLevel | null;
	off?: boolean;
	size?: keyof typeof SIZE;
	label?: string;
}) {
	const look =
		level === null ? "border-dotted border-ink-muted" : level === "clear" ? "border-ink bg-ink" : "border-ink bg-sheet";
	return (
		<span
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={`relative inline-block flex-none overflow-hidden rounded-[3px] border-[1.5px] ${SIZE[size]} ${look} ${off ? "opacity-30" : ""}`}
		>
			{level === "partial" && <span className="absolute inset-y-0 left-0 w-1/2 bg-ink" />}
		</span>
	);
}

// A CV's squares in the job's order, one per requirement, each named for screen readers.
export function EvidenceSquares({ checks, size = "sm", className = "" }: { checks: Check[]; size?: keyof typeof SIZE; className?: string }) {
	if (checks.length === 0) return null;
	return (
		<span className={`flex flex-wrap items-center gap-[3px] ${className}`}>
			{checks.map((check) => (
				<EvidenceSquare key={check.id} level={check.level} off={check.weight === "off"} size={size} label={squareLabel(check)} />
			))}
		</span>
	);
}

// The key to the squares, once per screen that shows them, with "partial" explained where it is first seen.
export function EvidenceKey({ className = "" }: { className?: string }) {
	const item = "inline-flex items-center gap-1.5";
	return (
		<p className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[12px] leading-[1.4] text-ink-muted ${className}`}>
			<span className={item}>
				<EvidenceSquare level="clear" /> Clear
			</span>
			<span className={item}>
				<EvidenceSquare level="partial" /> Partial: the CV shows part of it
			</span>
			<span className={item}>
				<EvidenceSquare level="none" /> None
			</span>
			<span className={item}>
				<EvidenceSquare level={null} /> Not checked yet
			</span>
		</p>
	);
}
