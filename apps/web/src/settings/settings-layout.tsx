import { Outlet, useRouterState } from "@tanstack/react-router";
import { useOrg } from "../dashboard/org.ts";
import { AppLink } from "../ui/app-link.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { SETTINGS_TABS, currentTab } from "./settings-nav.ts";

// Settings around the chosen sub-page: the h1, then the tab bar, then the page. The layout stays mounted while you
// move between tabs, so focus stays on the tab you chose instead of jumping back to the heading.
export function SettingsLayout() {
	const org = useOrg();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const current = currentTab(pathname);

	return (
		<div className="wrap page">
			{/* A size container: the sub-pages lay out by the room they have, which depends on the sidebar as well as the window. */}
			<div className="@container max-w-[1040px]">
				<PageHeader title="Settings" summary={`Your company, plan and team at ${org.name}, and your own account.`} />
				<nav aria-label="Settings" className="mt-6">
					<ul className="tablist">
						{SETTINGS_TABS.map((tab) => (
							<li key={tab.href} className="flex">
								<AppLink
									href={tab.href}
									className="tab @max-[400px]:px-2.5"
									aria-current={tab.href === current ? "page" : undefined}
								>
									{tab.label}
								</AppLink>
							</li>
						))}
					</ul>
				</nav>
				<div className="mt-8">
					<Outlet />
				</div>
			</div>
		</div>
	);
}
