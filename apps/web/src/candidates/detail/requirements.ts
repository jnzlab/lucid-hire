import type { LegacyRequirement, RequirementEvidence } from "../../lib/candidates.ts";

// "4 of 5": how many of the old scorer's requirements the CV met.
export const metCount = (items: LegacyRequirement[]) => `${items.filter(({ met }) => met).length} of ${items.length}`;

// How many of these requirements the CV clearly shows ("2 of 4"), and how many it shows part of.
export function levelCounts(items: RequirementEvidence[]) {
	const clear = items.filter(({ level }) => level === "clear").length;
	const partial = items.filter(({ level }) => level === "partial").length;
	return { clear: `${clear} of ${items.length}`, partial };
}

// What the score rests on, beside it: "2 of 4 requirements met · 1 partly". Off requirements don't count, so they're
// left out. Null when nothing counts.
export function evidenceCount(evidence: RequirementEvidence[]): string | null {
	const counted = evidence.filter(({ weight }) => weight !== "off");
	if (counted.length === 0) return null;
	const clear = counted.filter(({ level }) => level === "clear").length;
	const partial = counted.filter(({ level }) => level === "partial").length;
	return `${clear} of ${counted.length} requirements met${partial > 0 ? ` · ${partial} partly` : ""}`;
}

// How long the note waits after the last keystroke before it saves itself.
export const NOTE_SAVE_DELAY_MS = 800;
