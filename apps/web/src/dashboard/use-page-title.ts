import { useSyncExternalStore } from "react";

const SUFFIX = / · LucidHire$/;

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange);
	observer.observe(document.head, { subtree: true, childList: true, characterData: true });
	return () => observer.disconnect();
}

// The page's own name from its <title> ("Backend Engineer · LucidHire" → "Backend Engineer"), for the mobile top
// bar. Every dashboard page sets its title, so the bar can name a job or a candidate without knowing about them.
export function usePageTitle(): string {
	return useSyncExternalStore(
		subscribe,
		() => document.title.replace(SUFFIX, ""),
		() => "",
	);
}
