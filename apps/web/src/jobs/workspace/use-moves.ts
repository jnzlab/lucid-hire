import { useEffect, useRef, useState } from "react";
import type { Moves } from "../../lib/use-rubric.ts";

// How long the arrows stay after a re-rank, then how long they take to fade.
export const MOVES_SHOW_MS = 2400;
const MOVES_FADE_MS = 300;

export type MovesState = { moves: Moves; fresh: boolean };

// The arrows of the last re-rank: `show` puts them up, and they fade after MOVES_SHOW_MS. A newer re-rank replaces
// them, so they always describe the last change.
export function useMoves() {
	const [state, setState] = useState<MovesState>({ moves: new Map(), fresh: false });
	const timers = useRef<number[]>([]);
	const stop = () => {
		for (const timer of timers.current) window.clearTimeout(timer);
		timers.current = [];
	};
	useEffect(() => stop, []);

	const show = (moves: Moves) => {
		stop();
		setState({ moves, fresh: moves.size > 0 });
		if (moves.size === 0) return;
		timers.current = [
			window.setTimeout(() => setState((now) => ({ ...now, fresh: false })), MOVES_SHOW_MS),
			window.setTimeout(() => setState({ moves: new Map(), fresh: false }), MOVES_SHOW_MS + MOVES_FADE_MS),
		];
	};
	return { ...state, show };
}
