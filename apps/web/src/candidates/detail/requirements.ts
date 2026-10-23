import type { Requirement } from "../../lib/candidates.ts";

// "4 of 5": how many of these requirements the CV meets.
export const metCount = (items: Requirement[]) => `${items.filter(({ met }) => met).length} of ${items.length}`;

// How long the note waits after the last keystroke before it saves itself.
export const NOTE_SAVE_DELAY_MS = 800;
