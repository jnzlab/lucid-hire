import { useSearch } from "@tanstack/react-router";
import { ChevronLeft, Ellipsis, Keyboard, LogOut, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";
import { Logo } from "../components/logo.tsx";
import type { Org } from "../lib/me.ts";
import { HOVER_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { AppLink } from "../ui/app-link.tsx";
import { CountBadge } from "../ui/count-badge.tsx";
import { Drawer } from "../ui/drawer.tsx";
import { AccountPanel, ThemeChoice } from "./account-menu.tsx";
import { Avatar } from "./avatar.tsx";
import { NAV_ITEMS, NEW_JOB_PATH, SETTINGS_ITEM, backTarget, navCurrent, pageTitle } from "./nav.ts";
import { OpenJobs } from "./open-jobs.tsx";
import { PlanBadge } from "./plan-badge.tsx";
import { useShell } from "./shell-context.ts";
import { useToReviewTotal } from "./shell-data.ts";
import { useAccount } from "./use-account.ts";
import { usePageTitle } from "./use-page-title.ts";

// Below 768px (spec §2.2): a 56px top bar with the way back (or the logo), the page's name and the account avatar.
export function TopBar({ org, pathname }: { org: Org; pathname: string }) {
	const account = useAccount();
	const [accountOpen, setAccountOpen] = useState(false);
	const search = useSearch({ strict: false }) as { from?: unknown };
	const back = backTarget(pathname, search.from === "candidates");
	const titled = usePageTitle();
	// A page that hasn't set its title yet still shows the previous one, or the landing page's; name it from the path.
	const title = titled && !titled.startsWith("LucidHire") ? titled : pageTitle(pathname);

	return (
		<header className="top-bar">
			<div className="flex h-14 items-center gap-1 pr-[max(8px,env(safe-area-inset-right,0px))] pl-[max(6px,env(safe-area-inset-left,0px))]">
				{back ? (
					<AppLink href={back.href} className="icon-btn" aria-label={back.label}>
						<ChevronLeft size={22} aria-hidden="true" />
					</AppLink>
				) : (
					<AppLink href="/dashboard" aria-label="LucidHire dashboard" className="grid size-11 flex-none place-items-center rounded-md">
						<Logo compact />
					</AppLink>
				)}
				<p className="min-w-0 flex-1 truncate px-1 text-[16px] font-[650] text-ink" aria-hidden="true">
					{title}
				</p>
				<button
					type="button"
					aria-haspopup="dialog"
					aria-label={`Account: ${account.name ?? account.email ?? "your account"}`}
					onClick={() => setAccountOpen(true)}
					className="grid size-11 flex-none place-items-center rounded-full"
				>
					<Avatar account={account} />
				</button>
			</div>
			{accountOpen && (
				<Drawer side="bottom" title="Account" onClose={() => setAccountOpen(false)}>
					<AccountPanel role={org.role} onNavigate={() => setAccountOpen(false)} />
				</Drawer>
			)}
		</header>
	);
}

// The bottom tab bar: the three sections, Search (the palette) and More (a sheet). The current tab is ink with a
// marker bar above it and a heavier label, so colour is never the only signal.
export function TabBar({ org, pathname }: { org: Org; pathname: string }) {
	const shell = useShell();
	const toReview = useToReviewTotal();
	const [moreOpen, setMoreOpen] = useState(false);
	const moreCurrent = navCurrent(SETTINGS_ITEM, pathname);

	return (
		<>
			<nav aria-label="Main" className="tab-bar">
				{NAV_ITEMS.map((item) => {
					const Icon = item.icon;
					const badge = item.label === "Candidates" ? toReview : 0;
					return (
						<AppLink key={item.href} href={item.href} aria-current={navCurrent(item, pathname)} className="tab-bar-item">
							<span className="relative">
								<Icon size={20} aria-hidden="true" />
								{badge > 0 && <CountBadge count={badge} variant="marker" className="absolute -top-2 left-3.5 h-[18px] min-w-[18px] px-1 text-[10.5px]" />}
							</span>
							{item.label}
							{badge > 0 && <span className="sr-only">, {badge} to review</span>}
						</AppLink>
					);
				})}
				<button type="button" aria-haspopup="dialog" onClick={() => shell.openPalette()} className="tab-bar-item">
					<Search size={20} aria-hidden="true" />
					Search
				</button>
				<button
					type="button"
					aria-haspopup="dialog"
					aria-current={moreCurrent}
					onClick={() => setMoreOpen(true)}
					className="tab-bar-item"
				>
					<Ellipsis size={20} aria-hidden="true" />
					More
				</button>
			</nav>
			{moreOpen && <MoreSheet org={org} pathname={pathname} onClose={() => setMoreOpen(false)} />}
		</>
	);
}

// The More sheet: Post a job, the open jobs, Settings, the shortcuts (on devices with a keyboard), the theme and
// Sign out.
function MoreSheet({ org, pathname, onClose }: { org: Org; pathname: string; onClose: () => void }) {
	const shell = useShell();
	const hover = useMediaQuery(HOVER_QUERY, true);
	return (
		<Drawer side="bottom" title="More" onClose={onClose} bodyClassName="flex flex-col gap-5">
			<div className="flex items-center justify-between gap-3">
				<p className="truncate text-[15px] font-[650] text-ink">{org.name}</p>
				<PlanBadge onNavigate={onClose} />
			</div>
			<AppLink href={NEW_JOB_PATH} onClick={onClose} className="btn w-full">
				<Plus size={20} aria-hidden="true" />
				Post a job
			</AppLink>
			<OpenJobs pathname={pathname} onNavigate={onClose} />
			<ThemeChoice />
			<ul className="flex flex-col border-t border-line-2 pt-2">
				<li>
					<AppLink
						href={SETTINGS_ITEM.href}
						onClick={onClose}
						aria-current={navCurrent(SETTINGS_ITEM, pathname)}
						className={`nav-item min-h-12 ${navCurrent(SETTINGS_ITEM, pathname) ? "on-marker-area" : ""}`}
					>
						<Settings size={20} aria-hidden="true" /> Settings
					</AppLink>
				</li>
				{hover && (
					<li>
						<button
							type="button"
							onClick={() => {
								onClose();
								shell.openShortcuts();
							}}
							className="nav-item min-h-12 w-full"
						>
							<Keyboard size={20} aria-hidden="true" /> Keyboard shortcuts
						</button>
					</li>
				)}
				<li>
					<AppLink href="/sign-out" onClick={onClose} className="nav-item min-h-12">
						<LogOut size={20} aria-hidden="true" /> Sign out
					</AppLink>
				</li>
			</ul>
		</Drawer>
	);
}
