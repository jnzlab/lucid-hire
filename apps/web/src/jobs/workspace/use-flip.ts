import { type RefObject, useLayoutEffect, useRef } from "react";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "../../lib/use-media-query.ts";

// Slides the list's rows (each marked data-flip="<id>") from where they were to where a re-rank put them, the way
// the landing page's demo moved them: measure after the change, put each row back where it was with a transform, then
// let it go with a CSS transition. `order` is the rows' ids in order; nothing runs until it changes. With reduced
// motion the rows simply appear in their new places.
export function useFlip(listRef: RefObject<HTMLElement | null>, order: string) {
	const reduce = useMediaQuery(REDUCED_MOTION_QUERY, true);
	const tops = useRef(new Map<string, number>());
	useLayoutEffect(() => {
		const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-flip]") ?? [])];
		const now = new Map(rows.map((row) => [row.dataset.flip ?? "", row.getBoundingClientRect().top]));
		if (!reduce) {
			for (const row of rows) {
				const before = tops.current.get(row.dataset.flip ?? "");
				const after = now.get(row.dataset.flip ?? "") ?? 0;
				if (before === undefined || before === after) continue;
				row.classList.remove("flip-move");
				row.style.transform = `translateY(${before - after}px)`;
				// Rows paint in list order, so a row climbing past later ones would slide underneath them. Moving rows
				// ride above still ones while they slide, and a climb above a drop.
				row.style.zIndex = before > after ? "2" : "1";
				row.addEventListener("transitionend", () => row.style.removeProperty("z-index"), { once: true });
				// Reading the layout here makes the browser draw the old place before the transition starts.
				void row.offsetHeight;
				row.classList.add("flip-move");
				row.style.transform = "";
			}
		}
		tops.current = now;
	}, [listRef, order, reduce]);
}
