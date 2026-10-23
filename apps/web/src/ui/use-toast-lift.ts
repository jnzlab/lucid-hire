import { type RefObject, useEffect } from "react";

// Lifts the toasts above a bar stuck to the bottom of the screen (the bulk bar, the editor's save bar) while that bar
// is on screen, so a toast with Undo never covers the buttons that made it. The toast region reads `--toast-lift`.
export function useToastLift(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const root = document.documentElement;
		const observer = new ResizeObserver(() => root.style.setProperty("--toast-lift", `${element.offsetHeight + 12}px`));
		observer.observe(element);
		return () => {
			observer.disconnect();
			root.style.removeProperty("--toast-lift");
		};
	}, [ref]);
}
