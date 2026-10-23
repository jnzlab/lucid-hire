import { useRouter, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useHotkeys } from "../lib/hotkeys.ts";
import type { Org } from "../lib/me.ts";
import { useRecentScope } from "../lib/recent.ts";
import { DESKTOP_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { CommandPalette, type PaletteStep } from "./command-palette.tsx";
import { TabBar, TopBar } from "./mobile-nav.tsx";
import { NAV_ITEMS, NEW_JOB_PATH, SETTINGS_ITEM } from "./nav.ts";
import { type ShellActions, ShellContext } from "./shell-context.ts";
import { ShortcutsHelp } from "./shortcuts-help.tsx";
import { Sidebar } from "./sidebar.tsx";
import { readCollapsed, writeCollapsed } from "./sidebar-state.ts";

// The signed-in app's chrome: the sidebar from 768px (collapsible to an icon rail), a top bar and a bottom tab bar
// below it, the command palette, the shortcuts sheet and the global shortcuts. The page goes in `main`.
export function AppShell({ org, children }: { org: Org; children: ReactNode }) {
	const router = useRouter();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const desktop = useMediaQuery(DESKTOP_QUERY, true);
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const [palette, setPalette] = useState<PaletteStep | null>(null);
	const [help, setHelp] = useState(false);
	useRecentScope(org.id);

	const toggleSidebar = useCallback(() => {
		setCollapsed((was) => {
			writeCollapsed(!was);
			return !was;
		});
	}, []);
	const openShortcuts = useCallback(() => setHelp(true), []);
	const shell = useMemo<ShellActions>(
		() => ({ openPalette: (step = "root") => setPalette(step), openShortcuts, toggleSidebar, collapsed }),
		[openShortcuts, toggleSidebar, collapsed],
	);
	const go = (href: string) => () => void router.navigate({ href });

	useHotkeys([
		{
			keys: "mod+k",
			label: "Search or run a command",
			group: "Global",
			whileTyping: true,
			inModal: true,
			// Ctrl+K again closes it; inside another dialog it does nothing.
			run: () => {
				if (palette) setPalette(null);
				else if (!document.querySelector('[aria-modal="true"]')) setPalette("root");
			},
		},
		{ keys: "?", label: "Show keyboard shortcuts", group: "Global", run: openShortcuts },
		...[...NAV_ITEMS, SETTINGS_ITEM].map((item) => ({
			keys: item.hotkey,
			label: `Go to ${item.label}`,
			group: "Global",
			run: go(item.href),
		})),
		{ keys: "n", label: "Post a job", group: "Global", run: go(NEW_JOB_PATH) },
		{ keys: "mod+b", label: "Collapse or expand the sidebar", group: "Global", enabled: desktop, run: toggleSidebar },
	]);

	return (
		<ShellContext value={shell}>
			<div className="min-h-dvh bg-paper md:flex">
				<a className="skip" href="#main">
					Skip to content
				</a>
				{desktop && <Sidebar org={org} pathname={pathname} />}
				<div className="flex min-w-0 flex-1 flex-col">
					{!desktop && <TopBar org={org} pathname={pathname} />}
					<main id="main" tabIndex={-1} className="flex-1 scroll-mt-22 pb-[calc(64px+env(safe-area-inset-bottom,0px))] focus:outline-none md:pb-0">
						{children}
					</main>
				</div>
				{!desktop && <TabBar org={org} pathname={pathname} />}
				{palette && (
					<CommandPalette
						initialStep={palette}
						collapsed={collapsed}
						onClose={() => setPalette(null)}
						onToggleSidebar={toggleSidebar}
						onShortcuts={openShortcuts}
					/>
				)}
				{help && <ShortcutsHelp onClose={() => setHelp(false)} />}
			</div>
		</ShellContext>
	);
}
