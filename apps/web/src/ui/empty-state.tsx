import type { ReactNode } from "react";
import { Swipe } from "../components/swipe.tsx";

// What a list or card says when it has nothing to show: a heading, a sentence about what will appear and how, and
// the actions that get there. `swipe` puts the highlighter swipe behind the illustration (at most one per screen,
// design system §3); `illustration` is the art itself, decorative.
export function EmptyState({
	title,
	children,
	actions,
	illustration,
	swipe = false,
	headingLevel = 2,
	compact = false,
	className = "",
}: {
	title: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
	illustration?: ReactNode;
	swipe?: boolean;
	headingLevel?: 2 | 3;
	// Inside a card: less padding, a smaller heading.
	compact?: boolean;
	className?: string;
}) {
	const Heading = headingLevel === 2 ? "h2" : "h3";
	return (
		<div className={`flex flex-col items-center text-center ${compact ? "gap-3 px-4 py-8" : "gap-4 px-4 py-14"} ${className}`}>
			{(illustration || swipe) && (
				<div className="relative mb-2 grid min-h-24 w-full max-w-[320px] place-items-center" aria-hidden="true">
					{swipe && <Swipe className="swipe-art absolute inset-x-0 top-1/2 h-auto w-full -translate-y-1/2" />}
					{illustration && <div className="relative">{illustration}</div>}
				</div>
			)}
			<Heading
				className={`font-display font-[800] text-ink [font-stretch:108%] ${compact ? "text-[17px] leading-[1.2] tracking-[-0.01em]" : "text-[22px] leading-[1.1] tracking-[-0.02em]"}`}
			>
				{title}
			</Heading>
			{children && <p className="max-w-[46ch] text-[15px] text-ink-2">{children}</p>}
			{actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
		</div>
	);
}
