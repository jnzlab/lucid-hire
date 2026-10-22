import { type CSSProperties, useSyncExternalStore } from "react";

// Inline CSS custom properties (--d, --r ...) that drive the prototype's animations.
export function vars(values: Record<string, string | number>): CSSProperties {
	return values as CSSProperties;
}

export const NARROW = "(max-width: 900px)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}
