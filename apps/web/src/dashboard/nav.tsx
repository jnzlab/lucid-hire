import type { ReactNode } from "react";
import { IconJobs, IconOverview, IconSettings } from "../components/icons.tsx";

// The sidebar's pages, in order. Adding a page is one line here.
export const NAV_ITEMS: ReadonlyArray<{
	label: string;
	to: "/dashboard" | "/dashboard/jobs" | "/dashboard/settings/$";
	icon: ReactNode;
	// Pages under this one keep it highlighted: a job's page belongs to Jobs.
	owns?: RegExp;
}> = [
	{ label: "Overview", to: "/dashboard", icon: <IconOverview /> },
	{ label: "Jobs", to: "/dashboard/jobs", icon: <IconJobs />, owns: /^\/dashboard\/jobs\// },
	// Clerk's account pages live under it (/dashboard/settings/security and so on).
	{ label: "Settings", to: "/dashboard/settings/$", icon: <IconSettings />, owns: /^\/dashboard\/settings\// },
];

// "page" for the item's own page, "true" for a page inside it, so the sidebar always shows where you are.
export function navCurrent(item: (typeof NAV_ITEMS)[number], pathname: string): "page" | "true" | undefined {
	const path = pathname.replace(/\/+$/, "") || "/";
	if (path === item.to.replace(/\/\$$/, "")) return "page";
	return item.owns?.test(path) ? "true" : undefined;
}

// The last step of the mobile breadcrumb.
export function pageTitle(pathname: string): string {
	const path = pathname.replace(/\/+$/, "");
	if (path === "/dashboard") return "Overview";
	if (path === "/dashboard/jobs") return "Jobs";
	if (path === "/dashboard/settings" || path.startsWith("/dashboard/settings/")) return "Settings";
	if (path === "/dashboard/jobs/new") return "Post a job";
	if (/^\/dashboard\/jobs\/[^/]+\/edit$/.test(path)) return "Edit job";
	if (/^\/dashboard\/jobs\/[^/]+\/candidates\/[^/]+$/.test(path)) return "Candidate";
	if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return "Job";
	return "Page";
}
