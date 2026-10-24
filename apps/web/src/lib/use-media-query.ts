import { useCallback, useSyncExternalStore } from "react";

// Whether a CSS media query matches right now, kept up to date as the window changes. Without matchMedia (old
// browsers, some tests) it answers `fallback`.
export function useMediaQuery(query: string, fallback = false): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const list = window.matchMedia?.(query);
			list?.addEventListener("change", onChange);
			return () => list?.removeEventListener("change", onChange);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia?.(query).matches ?? fallback,
		() => fallback,
	);
}

// The dashboard's one layout breakpoint: the sidebar from 768px, the top bar and tab bar below it.
export const DESKTOP_QUERY = "(min-width: 768px)";
// Devices with a mouse or trackpad, where hover hints and keyboard hints make sense.
export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
// People who asked for less motion: animations rest finished (design system §2.6).
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
