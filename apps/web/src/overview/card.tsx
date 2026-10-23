import type { UseQueryResult } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Skeleton } from "../ui/skeleton.tsx";

// A sheet card on the paper (design system §4: card).
export const CARD = "min-w-0 rounded-xl bg-sheet shadow-card";
// Mono labels inside a card: "CVS UPLOADED · LAST 10 DAYS".
export const LABEL = "font-mono text-[11.5px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase";

// A part of the overview: a panel heading on the paper, a count or note beside it, then its content (usually a
// sheet card). It's a region named by its heading, so screen reader users can jump between the parts.
export function Section({
	title,
	badge,
	aside,
	children,
	className = "",
}: {
	title: string;
	// Beside the heading but outside it, so the region keeps a short name ("Waiting for you").
	badge?: ReactNode;
	// Right-aligned: a note or a link.
	aside?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 ${className}`}>
			<div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1">
				<div className="flex items-center gap-2.5">
					<h2 id={id} className="font-display text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
						{title}
					</h2>
					{badge}
				</div>
				{aside}
			</div>
			{children}
		</section>
	);
}

// What a card shows until its numbers arrive, or if they can't. Each card has its own query and its own state, so
// one slow or failing card never holds back the rest. `loading` draws a skeleton shaped like the content; it gets
// the words screen readers should hear.
export function CardState<T>({
	query,
	what,
	loading,
	children,
}: {
	query: UseQueryResult<T>;
	// Finishes "Loading …" and "We couldn't load …": "recent activity".
	what: string;
	loading?: (label: string) => ReactNode;
	children: (data: T) => ReactNode;
}) {
	const label = `Loading ${what}`;
	if (query.isPending) return loading ? loading(label) : <Skeleton lines={3} className="h-3" label={label} />;
	if (query.isError) {
		const busy = query.isFetching;
		return (
			<div role="alert" className="flex flex-col items-start gap-3">
				<p className="text-[15px] text-ink-2">
					<span className="font-[650] text-gap-ink">✕ We couldn't load {what}.</span> {query.error.message}
				</p>
				<button
					type="button"
					className="btn ghost xs pointer-coarse:min-h-11"
					aria-disabled={busy || undefined}
					onClick={() => {
						if (!busy) void query.refetch();
					}}
				>
					<RotateCw size={16} aria-hidden="true" />
					{busy ? "Trying again" : "Try again"}
				</button>
			</div>
		);
	}
	return children(query.data);
}

// A plain sentence where a card has nothing to show yet: what will appear, and how to get it there.
export function CardEmpty({ children }: { children: ReactNode }) {
	return <p className="rounded-lg bg-paper px-4 py-4 text-[15px] leading-[1.5] text-ink-2">{children}</p>;
}
