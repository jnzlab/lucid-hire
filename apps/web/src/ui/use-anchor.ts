import { useLayoutEffect, useState } from "react";

export type Align = "start" | "end" | "center";
export type Placement = { side?: "bottom" | "top"; align?: Align };

const GAP = 6;
const EDGE = 8;

// Where a menu or popover goes: under its trigger (over it when there's no room below), lined up with the
// trigger's start or end, and kept inside the window.
export function anchor(trigger: DOMRect, floating: DOMRect, { side = "bottom", align = "start" }: Placement) {
	const below = trigger.bottom + GAP;
	const above = trigger.top - GAP - floating.height;
	const fitsBelow = below + floating.height <= window.innerHeight - EDGE;
	const fitsAbove = above >= EDGE;
	let top = side === "top" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
	let left = align === "end" ? trigger.right - floating.width : align === "center" ? trigger.left + (trigger.width - floating.width) / 2 : trigger.left;
	left = Math.min(Math.max(left, EDGE), window.innerWidth - floating.width - EDGE);
	top = Math.max(top, EDGE);
	return { top, left, maxHeight: window.innerHeight - top - EDGE };
}

// Keeps a fixed-position layer next to its trigger while it is open, through scrolling and resizing.
export function useAnchor(open: boolean, trigger: HTMLElement | null, floating: HTMLElement | null, placement: Placement) {
	const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
	const { side, align } = placement;
	useLayoutEffect(() => {
		if (!open || !trigger || !floating) return;
		const measure = () => setPosition(anchor(trigger.getBoundingClientRect(), floating.getBoundingClientRect(), { side, align }));
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [open, trigger, floating, side, align]);
	return open ? position : null;
}
