import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { IconSidebar } from "../components/icons.tsx";
import { Logo } from "../components/logo.tsx";
import type { Org } from "../lib/me.ts";
import { AccountButton } from "./account-button.tsx";
import { MobileBar } from "./mobile-bar.tsx";
import { NavLinks } from "./nav-links.tsx";
import { PlanBadge } from "./plan-badge.tsx";
import { readCollapsed, writeCollapsed } from "./sidebar-state.ts";

const isEditable = (target: EventTarget | null) =>
	target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// The signed-in app's chrome: a sidebar on wide screens (collapsible to an icon rail) and a top bar with a
// slide-out menu on narrow ones. The page itself goes in `main`.
export function AppShell({ org, children }: { org: Org; children: ReactNode }) {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const pathname = useRouterState({ select: (state) => state.location.pathname });

	const toggle = () => {
		setCollapsed(!collapsed);
		writeCollapsed(!collapsed);
	};
	const onKey = useEffectEvent((event: KeyboardEvent) => {
		if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
		if (isEditable(event.target)) return;
		event.preventDefault();
		toggle();
	});
	useEffect(() => {
		const listener = (event: KeyboardEvent) => onKey(event);
		document.addEventListener("keydown", listener);
		return () => document.removeEventListener("keydown", listener);
	}, []);

	return (
		<div className="min-h-dvh bg-paper md:flex">
			<a className="skip" href="#main">
				Skip to content
			</a>
			<aside
				aria-label="Dashboard"
				className={`sticky top-0 hidden h-dvh flex-none flex-col gap-5 overflow-y-auto border-r border-line bg-paper-2 py-4 transition-[width] duration-200 ease-out md:flex ${collapsed ? "w-[72px] items-center px-2" : "w-[248px] px-3"}`}
			>
				<div className={`flex items-center ${collapsed ? "flex-col gap-2" : "justify-between pl-1"}`}>
					<Link to="/dashboard" aria-label="LucidHire dashboard" className="rounded-[3px]">
						<Logo compact={collapsed} />
					</Link>
					<button
						type="button"
						onClick={toggle}
						aria-expanded={!collapsed}
						aria-keyshortcuts="Control+B Meta+B"
						title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
						className="inline-grid size-11 place-items-center rounded-md text-ink-muted hover:bg-line-2 hover:text-ink"
					>
						<IconSidebar collapsed={collapsed} />
						<span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
					</button>
				</div>
				{!collapsed && (
					<div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-4">
						<p className="truncate font-mono text-[13px] text-ink-2" title={org.name}>
							{org.name}
						</p>
						<PlanBadge />
					</div>
				)}
				<NavLinks pathname={pathname} collapsed={collapsed} />
				<div className={`mt-auto flex items-center gap-3 border-t border-line pt-4 ${collapsed ? "flex-col" : "px-1"}`}>
					<AccountButton />
					{!collapsed && (
						<p className="font-mono text-[12px] text-ink-muted">
							Your role: {org.role === "admin" ? "Admin" : "Member"}
						</p>
					)}
				</div>
				{collapsed && (
					<p className="sr-only">Your role: {org.role === "admin" ? "Admin" : "Member"}</p>
				)}
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<MobileBar org={org} pathname={pathname} />
				<main id="main" className="flex-1 scroll-mt-22">
					{children}
				</main>
			</div>
		</div>
	);
}
