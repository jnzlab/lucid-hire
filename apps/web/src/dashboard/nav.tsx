import type { ReactNode } from "react";
import { IconJobs } from "../components/icons.tsx";

// The sidebar's pages, in order. Adding a page is one line here.
export const NAV_ITEMS: ReadonlyArray<{
	label: string;
	to: "/dashboard";
	icon: ReactNode;
	// Pages under this one keep it highlighted: a job's page belongs to Jobs.
	owns?: RegExp;
}> = [
	{ label: "Jobs", to: "/dashboard", icon: <IconJobs />, owns: /^\/dashboard\/jobs(\/|$)/ },
];

// "page" for the item's own page, "true" for a page inside it, so the sidebar always shows where you are.
export function navCurrent(item: (typeof NAV_ITEMS)[number], pathname: string): "page" | "true" | undefined {
	const path = pathname.replace(/\/+$/, "") || "/";
	if (path === item.to) return "page";
	return item.owns?.test(path) ? "true" : undefined;
}

// The last step of the mobile breadcrumb.
export function pageTitle(pathname: string): string {
	const path = pathname.replace(/\/+$/, "");
	if (path === "/dashboard") return "Jobs";
	if (path === "/dashboard/jobs/new") return "Post a job";
	if (/^\/dashboard\/jobs\/[^/]+\/edit$/.test(path)) return "Edit job";
	if (/^\/dashboard\/jobs\/[^/]+\/candidates\/[^/]+$/.test(path)) return "Candidate";
	if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return "Job";
	return "Page";
}
