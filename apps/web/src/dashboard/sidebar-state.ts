const KEY = "lucidhire.sidebar";

// Read before the first render, so a collapsed sidebar never flashes open. Storage can be blocked, so a
// failure means the default (open).
export function readCollapsed(): boolean {
	try {
		return localStorage.getItem(KEY) === "collapsed";
	} catch {
		return false;
	}
}

export function writeCollapsed(collapsed: boolean) {
	try {
		localStorage.setItem(KEY, collapsed ? "collapsed" : "open");
	} catch {
		// Not saved; it still works for this visit.
	}
}
