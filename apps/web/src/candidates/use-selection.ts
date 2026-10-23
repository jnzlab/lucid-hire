import { useCallback, useMemo, useRef, useState } from "react";

export type Selection = {
	// The checked ids, only ever ones that are in `ids`. Read it; change it through the functions below.
	selected: Set<string>;
	toggle: (id: string) => void;
	// Shift+click: gives every row from the last one toggled up to this one the state this one is changing to.
	toggleRange?: (id: string) => void;
	// Checks every row, or unchecks them all when every row is already checked (the header checkbox).
	toggleAll: () => void;
	clear: () => void;
	// Every row is checked (and there is at least one).
	allChecked: boolean;
	// Some rows are checked but not all: the header checkbox's mixed state.
	someChecked: boolean;
};

// The checkboxes of a candidate list, for the bulk bar. `ids` are the rows on screen, in order. A checked row that
// leaves the list (another filter, another page, a delete, a decision under "To review") is forgotten, so an action
// never reaches a row nobody can see, and the row doesn't come back checked later.
export function useSelection(ids: string[]): Selection {
	const [stored, setStored] = useState<Set<string>>(() => new Set());
	// The row the next shift+click counts from.
	const anchor = useRef<string | null>(null);
	const present = useMemo(() => new Set(ids), [ids]);

	// Rows that left are forgotten while rendering (React's "adjust state when a prop changes"), so the bar never
	// counts them, not even for a frame.
	let selected = stored;
	if ([...stored].some((id) => !present.has(id))) {
		selected = new Set([...stored].filter((id) => present.has(id)));
		setStored(selected);
	}

	const toggle = useCallback(
		(id: string) => {
			if (!present.has(id)) return;
			anchor.current = id;
			setStored((set) => {
				const next = new Set(set);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
		},
		[present],
	);

	const toggleRange = useCallback(
		(id: string) => {
			if (!present.has(id)) return;
			const from = anchor.current && present.has(anchor.current) ? anchor.current : id;
			anchor.current = id;
			const [start, end] = [ids.indexOf(from), ids.indexOf(id)].sort((a, b) => a - b);
			setStored((set) => {
				const next = new Set(set);
				const checking = !set.has(id);
				for (const row of ids.slice(start, end + 1)) {
					if (checking) next.add(row);
					else next.delete(row);
				}
				return next;
			});
		},
		[ids, present],
	);

	const toggleAll = useCallback(() => {
		setStored((set) => (ids.length > 0 && ids.every((id) => set.has(id)) ? new Set() : new Set(ids)));
	}, [ids]);

	const clear = useCallback(() => {
		anchor.current = null;
		setStored(new Set());
	}, []);

	const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
	return { selected, toggle, toggleRange, toggleAll, clear, allChecked, someChecked: selected.size > 0 && !allChecked };
}
