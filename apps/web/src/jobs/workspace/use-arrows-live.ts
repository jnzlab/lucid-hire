import { type RefObject, useEffect, useState } from "react";

// Whether ↑ and ↓ should move through the candidate list from where focus is now. They shouldn't while focus is in
// the detail pane (there they scroll it), on a radio (they move between its options) or in a menu or popover (which
// have their own arrow keys). Inside a modal they wouldn't run anyway; counting that as live keeps the shortcuts
// sheet's listing whole while it is open. J and K work everywhere.
export function arrowsLiveAt(target: EventTarget | null, detail: HTMLElement | null): boolean {
	if (!(target instanceof Element)) return true;
	if (target.closest('[aria-modal="true"]')) return true;
	if (detail?.contains(target)) return false;
	if (target instanceof HTMLInputElement && target.type === "radio") return false;
	return target.closest('[role="menu"],[role="dialog"],[role="radiogroup"]') === null;
}

export function useArrowsLive(detailRef: RefObject<HTMLElement | null>): boolean {
	const [live, setLive] = useState(true);
	useEffect(() => {
		const check = () => setLive(arrowsLiveAt(document.activeElement, detailRef.current));
		// On focusout the next element isn't focused yet, so look once the move has finished.
		const later = () => window.setTimeout(check, 0);
		document.addEventListener("focusin", check);
		document.addEventListener("focusout", later);
		check();
		return () => {
			document.removeEventListener("focusin", check);
			document.removeEventListener("focusout", later);
		};
	}, [detailRef]);
	return live;
}
