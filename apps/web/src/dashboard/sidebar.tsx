import { Keyboard, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { useBilling } from "../lib/billing.ts";
import type { Org } from "../lib/me.ts";
import { Logo } from "../components/logo.tsx";
import { AppLink } from "../ui/app-link.tsx";
import { CountBadge } from "../ui/count-badge.tsx";
import { IconButton } from "../ui/icon-button.tsx";
import { Kbd, Shortcut } from "../ui/kbd.tsx";
import { Meter } from "../ui/meter.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { IS_APPLE } from "../lib/hotkeys.ts";
import { AccountMenu } from "./account-menu.tsx";
import { NAV_ITEMS, NEW_JOB_PATH, type NavItem, SETTINGS_ITEM, SETTINGS_PAGES, navCurrent } from "./nav.ts";
import { OpenJobs } from "./open-jobs.tsx";
import { PlanBadge } from "./plan-badge.tsx";
import { useShell } from "./shell-context.ts";
import { useToReviewTotal } from "./shell-data.ts";

// The desktop sidebar (spec §2.1): 256px, or a 64px icon rail when collapsed (Ctrl/⌘+B). Brand and collapse, the
// company and plan, search, Post a job, the sections, the open jobs, then the monthly allowance on Free, Settings,
// the shortcuts and the account menu.
export function Sidebar({ org, pathname }: { org: Org; pathname: string }) {
	const shell = useShell();
	const collapsed = shell.collapsed;
	const toReview = useToReviewTotal();

	return (
		<aside
			aria-label="Sidebar"
			className={`sticky top-0 flex h-dvh flex-none flex-col border-r border-line bg-paper-2 transition-[width] duration-200 ease-out ${collapsed ? "w-16" : "w-64"}`}
		>
			<div className={`flex flex-none flex-col gap-3 pt-3 ${collapsed ? "items-center px-2.5" : "px-3"}`}>
				<div className={`flex items-center ${collapsed ? "flex-col gap-1" : "justify-between pl-1"}`}>
					<AppLink href="/dashboard" aria-label="LucidHire dashboard" className="rounded-[3px]">
						<Logo compact={collapsed} />
					</AppLink>
					<IconButton
						label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						icon={collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
						shortcut="mod+b"
						tooltipSide={collapsed ? "right" : "bottom"}
						aria-expanded={!collapsed}
						onClick={shell.toggleSidebar}
					/>
				</div>
				{collapsed ? (
					<p className="sr-only">
						{org.name}, your role: {org.role === "admin" ? "Admin" : "Member"}
					</p>
				) : (
					<div className="flex min-h-8 items-center justify-between gap-2 border-t border-line pt-3 pl-1">
						<p className="truncate text-[15px] leading-[1.2] font-[650] text-ink" title={org.name}>
							{org.name}
						</p>
						<PlanBadge />
					</div>
				)}
				{collapsed ? (
					<IconButton
						label="Search or jump to"
						icon={<Search size={20} aria-hidden="true" />}
						shortcut="mod+k"
						tooltipSide="right"
						aria-haspopup="dialog"
						onClick={() => shell.openPalette()}
					/>
				) : (
					<button
						type="button"
						aria-haspopup="dialog"
						aria-keyshortcuts="Control+K Meta+K"
						onClick={() => shell.openPalette()}
						className="search-field"
					>
						<Search size={16} aria-hidden="true" className="flex-none" />
						<span className="min-w-0 flex-1 truncate">Search or jump to…</span>
						<Kbd>{IS_APPLE ? "⌘K" : "Ctrl K"}</Kbd>
					</button>
				)}
				{collapsed ? (
					<Tooltip content="Post a job" side="right" describe={false}>
						<AppLink href={NEW_JOB_PATH} className="btn size-11 p-0">
							<Plus size={20} aria-hidden="true" />
							<span className="sr-only">Post a job</span>
						</AppLink>
					</Tooltip>
				) : (
					<AppLink href={NEW_JOB_PATH} className="btn w-full">
						<Plus size={20} aria-hidden="true" />
						Post a job
					</AppLink>
				)}
			</div>

			<nav aria-label="Main" className={`flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pt-5 pb-4 ${collapsed ? "items-center px-2.5" : "px-3"}`}>
				<ul className="flex flex-col gap-0.5">
					{NAV_ITEMS.map((item) => (
						<li key={item.href}>
							<NavLink item={item} pathname={pathname} collapsed={collapsed} badge={item.label === "Candidates" ? toReview : 0} />
						</li>
					))}
				</ul>
				{!collapsed && <OpenJobs pathname={pathname} />}
			</nav>

			<div className={`flex flex-none flex-col gap-1 border-t border-line py-3 ${collapsed ? "items-center px-2.5" : "px-3"}`}>
				{!collapsed && <Allowance />}
				<NavLink item={SETTINGS_ITEM} pathname={pathname} collapsed={collapsed} badge={0} />
				{collapsed ? (
					<IconButton label="Keyboard shortcuts" icon={<Keyboard size={20} aria-hidden="true" />} shortcut="?" tooltipSide="right" onClick={shell.openShortcuts} />
				) : (
					<button type="button" onClick={shell.openShortcuts} aria-keyshortcuts="?" className="nav-item w-full">
						<Keyboard size={20} aria-hidden="true" className="flex-none" />
						<span className="flex-1 text-left">Keyboard shortcuts</span>
						<Shortcut keys="?" />
					</button>
				)}
				<AccountMenu role={org.role} collapsed={collapsed} />
			</div>
		</aside>
	);
}

// A section link. In the rail it is the icon with a tooltip, and a to-review count becomes a small ink dot.
function NavLink({ item, pathname, collapsed, badge }: { item: NavItem; pathname: string; collapsed: boolean; badge: number }) {
	const current = navCurrent(item, pathname);
	const Icon = item.icon;
	const link = (
		<AppLink
			href={item.href}
			aria-current={current}
			className={`nav-item relative ${collapsed ? "is-rail" : ""} ${current ? "on-marker-area" : ""}`}
		>
			<Icon size={20} aria-hidden="true" className="flex-none" />
			<span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{item.label}</span>
			{badge > 0 &&
				(collapsed ? (
					<>
						<span className="absolute top-2 right-2 size-2 rounded-full bg-ink" aria-hidden="true" />
						<span className="sr-only">, {badge} to review</span>
					</>
				) : (
					<CountBadge count={badge} variant="marker" label="to review" />
				))}
		</AppLink>
	);
	if (!collapsed) return link;
	return (
		<Tooltip content={badge > 0 ? `${item.label} · ${badge} to review` : item.label} side="right" describe={false}>
			{link}
		</Tooltip>
	);
}

// Free plan only: how many of the month's jobs are used, with the way to more. Only admins can upgrade, so members
// are told who can.
function Allowance() {
	const billing = useBilling();
	const usage = billing.data?.usage;
	if (!billing.data || billing.data.effectivePlan !== "free" || !usage || usage.jobsLimit === null) return null;
	return (
		<div className="mb-2 flex flex-col gap-2 rounded-lg border border-line bg-sheet p-3">
			<Meter compact label="Jobs this month" value={usage.jobsThisMonth} max={usage.jobsLimit} />
			{billing.data.isAdmin ? (
				<AppLink href={SETTINGS_PAGES.billing} className="self-start text-[13.5px] font-semibold text-ink underline underline-offset-[.18em]">
					Upgrade
				</AppLink>
			) : (
				<p className="text-[13px] text-ink-muted">Ask an admin for more jobs.</p>
			)}
		</div>
	);
}
