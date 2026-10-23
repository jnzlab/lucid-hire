// The settings sub-pages, in tab order. Each is its own address, so the bar is a row of links, not a tablist.
export const SETTINGS_TABS = [
	{ label: "Company", href: "/dashboard/settings" },
	{ label: "Plan & billing", href: "/dashboard/settings/billing" },
	{ label: "Team", href: "/dashboard/settings/team" },
	{ label: "Account", href: "/dashboard/settings/account" },
] as const;

// Where Clerk's profile panel lives; its own pages (security and the rest) go under it.
export const ACCOUNT_PATH = "/dashboard/settings/account";

// Which tab the address belongs to: Company only on its own page, the others on theirs and everything under them
// (Clerk's account pages go deeper).
export function currentTab(pathname: string): string {
	const path = pathname.replace(/\/+$/, "");
	const match = SETTINGS_TABS.slice(1).find((tab) => path === tab.href || path.startsWith(`${tab.href}/`));
	return match?.href ?? SETTINGS_TABS[0].href;
}
