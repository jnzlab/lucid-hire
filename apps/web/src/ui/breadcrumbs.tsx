import { Fragment } from "react";
import { AppLink } from "./app-link.tsx";

export type Crumb = { label: string; href?: string };

// The way back up: "Jobs / Backend Engineer / Grace Turner" in mono 13px. Every step but the last is a link; the
// last is the current page.
export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
	if (items.length === 0) return null;
	return (
		<nav aria-label="Breadcrumb" className={`min-w-0 ${className}`}>
			<ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px] leading-[1.4] text-ink-muted">
				{items.map((item, index) => {
					const last = index === items.length - 1;
					return (
						<Fragment key={`${item.label}-${index}`}>
							{index > 0 && (
								<li aria-hidden="true" className="text-ink-faint">
									/
								</li>
							)}
							<li className={`min-w-0 ${last ? "truncate text-ink-2" : ""}`} aria-current={last ? "page" : undefined}>
								{item.href && !last ? (
									<AppLink href={item.href} className="inline-flex min-h-8 items-center rounded-[3px] pointer-coarse:min-h-11 [overflow-wrap:anywhere] hover:text-ink hover:underline hover:underline-offset-[.18em]">
										{item.label}
									</AppLink>
								) : (
									item.label
								)}
							</li>
						</Fragment>
					);
				})}
			</ol>
		</nav>
	);
}
