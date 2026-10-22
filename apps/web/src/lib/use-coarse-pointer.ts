import { useSyncExternalStore } from "react";

const COARSE = "(pointer: coarse)";

function subscribe(onChange: () => void) {
	const query = window.matchMedia?.(COARSE);
	query?.addEventListener("change", onChange);
	return () => query?.removeEventListener("change", onChange);
}

// True on a phone or tablet, where the main pointer is a finger. There is nothing to drag files from there.
export function useCoarsePointer() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia?.(COARSE).matches ?? false,
		() => false,
	);
}
