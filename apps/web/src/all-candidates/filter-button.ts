// The toolbar's filter buttons look like the search field beside them; one that narrows the list gets an ink
// border, and its value is always written on it, so the border is never the only sign.
export const filterButton = (active: boolean) =>
	`inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border-[1.5px] bg-sheet px-3 text-[15px] text-ink transition-colors ${active ? "border-ink" : "border-line hover:border-ink-faint"}`;
