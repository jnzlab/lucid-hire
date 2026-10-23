import { type ReactNode, useEffect, useRef } from "react";
import { Breadcrumbs, type Crumb } from "./breadcrumbs.tsx";

// The top of every dashboard page (spec §2.7): an optional breadcrumb, the h1, a one-line summary in plain words
// and the page's actions on the right (they wrap under the title on narrow screens). The h1 takes focus when the
// page appears, so keyboard and screen reader users start at the top of the new page.
export function PageHeader({
	title,
	breadcrumbs,
	summary,
	actions,
	children,
	focusOnMount = true,
	className = "",
}: {
	title: ReactNode;
	breadcrumbs?: Crumb[];
	// "5 open · 2 drafts · 2 closed" or a sentence. Archivo 16px, ink-2.
	summary?: ReactNode;
	actions?: ReactNode;
	// Anything else under the summary (a meta line, a notice).
	children?: ReactNode;
	focusOnMount?: boolean;
	className?: string;
}) {
	const titleRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (focusOnMount) titleRef.current?.focus({ preventScroll: true });
	}, [focusOnMount]);

	return (
		<header className={`flex flex-col gap-3 ${className}`}>
			{breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
				<div className="min-w-0 flex-[1_1_320px]">
					{/* Focused from code, not by a click or Tab, so it gets no ring. */}
					<h1 ref={titleRef} tabIndex={-1} className="page-title focus:outline-none">
						{title}
					</h1>
					{summary && <p className="mt-2 text-[16px] leading-[1.5] text-ink-2">{summary}</p>}
					{children}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
			</div>
		</header>
	);
}
