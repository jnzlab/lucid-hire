import { BriefcaseBusiness, LayoutDashboard, type LucideIcon, Settings, Users } from "lucide-react";
import { candidatesViewHref } from "../lib/all-candidates.ts";

export type NavItem = {
	label: string;
	href: string;
	icon: LucideIcon;
	// Pages under this one keep it highlighted: a job's page belongs to Jobs.
	owns?: RegExp;
	// The "go to" shortcut.
	hotkey: string;
};

// The dashboard's sections, in order. The sidebar, the tab bar, the command palette and the `g` shortcuts all read
// this list.
export const NAV_ITEMS: readonly NavItem[] = [
	{ label: "Overview", href: "/dashboard", icon: LayoutDashboard, hotkey: "g o" },
	{ label: "Jobs", href: "/dashboard/jobs", icon: BriefcaseBusiness, owns: /^\/dashboard\/jobs\//, hotkey: "g j" },
	{ label: "Candidates", href: "/dashboard/candidates", icon: Users, owns: /^\/dashboard\/candidates\//, hotkey: "g c" },
];
export const SETTINGS_ITEM: NavItem = {
	label: "Settings",
	href: "/dashboard/settings",
	icon: Settings,
	owns: /^\/dashboard\/settings\//,
	hotkey: "g s",
};

// Settings' sub-pages, for the palette and the account menu.
export const SETTINGS_PAGES = {
	company: "/dashboard/settings",
	billing: "/dashboard/settings/billing",
	team: "/dashboard/settings/team",
	account: "/dashboard/settings/account",
} as const;
export const NEW_JOB_PATH = "/dashboard/jobs/new";

const trim = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

// "page" for the item's own page, "true" for a page inside it, so the navigation always shows where you are.
export function navCurrent(item: Pick<NavItem, "href" | "owns">, pathname: string): "page" | "true" | undefined {
	const path = trim(pathname);
	if (path === item.href) return "page";
	return item.owns?.test(path) ? "true" : undefined;
}

// The current job's id, from /dashboard/jobs/<id>/…, for highlighting it in the sidebar's open jobs.
export function currentJobId(pathname: string): string | null {
	const match = /^\/dashboard\/jobs\/([^/]+)/.exec(trim(pathname));
	return match && match[1] !== "new" ? match[1] : null;
}

// A name for the page, for the mobile top bar until the page sets its own title.
export function pageTitle(pathname: string): string {
	const path = trim(pathname);
	if (path === "/dashboard") return "Overview";
	if (path === "/dashboard/jobs") return "Jobs";
	if (path === "/dashboard/jobs/new") return "Post a job";
	if (path === "/dashboard/candidates") return "Candidates";
	if (path === SETTINGS_PAGES.billing) return "Plan & billing";
	if (path === SETTINGS_PAGES.team) return "Team";
	if (path.startsWith(SETTINGS_PAGES.account)) return "Account";
	if (path === "/dashboard/settings" || path.startsWith("/dashboard/settings/")) return "Settings";
	if (/^\/dashboard\/jobs\/[^/]+\/edit$/.test(path)) return "Edit job";
	if (/^\/dashboard\/jobs\/[^/]+\/candidates\/[^/]+$/.test(path)) return "Candidate";
	if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return "Job";
	return "Dashboard";
}

// Where the mobile top bar's back button goes: one level up from a detail page, nowhere from a section. A candidate
// opened from the All candidates list goes back to that list.
export function backTarget(pathname: string, fromCandidates = false): { href: string; label: string } | null {
	const path = trim(pathname);
	const candidate = /^\/dashboard\/jobs\/([^/]+)\/candidates\/[^/]+$/.exec(path);
	if (candidate && fromCandidates) return { href: candidatesViewHref(), label: "Back to candidates" };
	if (candidate) return { href: `/dashboard/jobs/${candidate[1]}`, label: "Back to the job" };
	const edit = /^\/dashboard\/jobs\/([^/]+)\/edit$/.exec(path);
	if (edit) return { href: `/dashboard/jobs/${edit[1]}`, label: "Back to the job" };
	if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return { href: "/dashboard/jobs", label: "Back to jobs" };
	return null;
}
