import { useLayoutEffect, useSyncExternalStore } from "react";
import { useSession } from "./session.ts";

// The jobs and candidates opened most recently, for the command palette's "Recent" group. Kept in localStorage per
// user and company, so another person on the same browser never sees them, and signing out clears the user's own.
export type RecentVisit =
	| { kind: "job"; id: string; title: string; at: number }
	| { kind: "candidate"; id: string; jobId: string; name: string; jobTitle?: string; at: number };
// What a page passes to `rememberVisit`: the visit without the time.
export type VisitInput =
	| { kind: "job"; id: string; title: string }
	| { kind: "candidate"; id: string; jobId: string; name: string; jobTitle?: string };

export const RECENT_KEY = "lh-recent";
const KEEP = 10;
export const RECENT_SHOWN = 5;

// Each user's visits in each company, under "<user id>/<company id>".
type Saved = Record<string, RecentVisit[]>;
const scopeOf = (userId: string, orgId: string) => `${userId}/${orgId}`;

let scope: string | null = null;
let visits: RecentVisit[] = [];
const listeners = new Set<() => void>();

const notify = () => {
	for (const listener of listeners) listener();
};

function readAll(): Saved {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Saved) : {};
	} catch {
		return {};
	}
}

function writeAll(saved: Saved) {
	try {
		if (Object.keys(saved).length > 0) localStorage.setItem(RECENT_KEY, JSON.stringify(saved));
		else localStorage.removeItem(RECENT_KEY);
	} catch {
		// Not saved; the palette still shows what is in memory for this visit.
	}
}

function load() {
	const saved = scope ? readAll()[scope] : undefined;
	visits = Array.isArray(saved) ? saved.filter((visit) => visit && typeof visit.id === "string") : [];
	notify();
}

// Replaces the current scope's visits, in memory and in storage.
function store(next: RecentVisit[]) {
	if (!scope) return;
	visits = next;
	writeAll({ ...readAll(), [scope]: visits });
	notify();
}

// Called by the dashboard shell once the company is known; visits are stored and read under the signed-in user and
// that company. A layout effect, so the scope is set before any page's own effects call `rememberVisit`.
export function useRecentScope(orgId: string) {
	const { userId } = useSession();
	useLayoutEffect(() => {
		if (!userId) return;
		scope = scopeOf(userId, orgId);
		load();
		return () => {
			scope = null;
			visits = [];
		};
	}, [userId, orgId]);
}

// Pages call this when a job or candidate has loaded:
//   useEffect(() => { if (job) rememberVisit({ kind: "job", id: job.id, title: job.title }) }, [job?.id, job?.title]);
export function rememberVisit(visit: VisitInput) {
	if (!scope) return;
	const next = [{ ...visit, at: Date.now() } as RecentVisit, ...visits.filter((v) => !(v.kind === visit.kind && v.id === visit.id))];
	store(next.slice(0, KEEP));
}

// Drops a job or candidate that no longer exists (after a delete).
export function forgetVisit(kind: RecentVisit["kind"], id: string) {
	if (!visits.some((v) => v.kind === kind && v.id === id)) return;
	store(visits.filter((v) => !(v.kind === kind && v.id === id)));
}

// Drops a deleted job and its candidates, which went with it.
export function forgetJobVisits(jobId: string) {
	const gone = (v: RecentVisit) => (v.kind === "job" ? v.id === jobId : v.jobId === jobId);
	if (!visits.some(gone)) return;
	store(visits.filter((v) => !gone(v)));
}

// At sign-out: drops everything the user opened, in every company, so the next person at this browser can't see it.
// Other users' visits stay for when they sign in again.
export function forgetUserVisits(userId: string | null | undefined) {
	if (!userId) return;
	const prefix = `${userId}/`;
	const saved = readAll();
	if (Object.keys(saved).some((key) => key.startsWith(prefix))) {
		writeAll(Object.fromEntries(Object.entries(saved).filter(([key]) => !key.startsWith(prefix))));
	}
	if (scope?.startsWith(prefix)) {
		visits = [];
		notify();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

// The most recent visits first, newest five by default.
export function useRecentVisits(limit = RECENT_SHOWN): RecentVisit[] {
	const all = useSyncExternalStore(subscribe, () => visits, () => visits);
	return all.length > limit ? all.slice(0, limit) : all;
}
