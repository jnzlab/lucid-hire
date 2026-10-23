import { type ReactNode, useId } from "react";
import type { Badge } from "./plan-status.ts";

// One block of a settings page (design system §4: card): a panel heading, an optional sentence about it, actions on
// the right, then the content. In dark mode a 1px line border separates it from the page.
export function SettingsCard({
	title,
	description,
	actions,
	children,
	id,
	className = "",
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
	id?: string;
	className?: string;
}) {
	const headingId = useId();
	return (
		<section
			id={id}
			aria-labelledby={headingId}
			className={`scroll-mt-6 rounded-xl border border-transparent bg-sheet p-5 shadow-card dark:border-line @min-[561px]:p-7 ${className}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<div className="min-w-0 flex-[1_1_280px]">
					<h2 id={headingId} className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
						{title}
					</h2>
					{description && <p className="mt-1.5 text-[15px] leading-[1.5] text-ink-muted">{description}</p>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
			</div>
			{children !== undefined && <div className="mt-5">{children}</div>}
		</section>
	);
}

// A label and its value side by side when the page is 640px wide or more, stacked below, divided from the next row by a line-2 rule.
export function SettingsRow({ label, labelFor, children }: { label: ReactNode; labelFor?: string; children: ReactNode }) {
	const Label = labelFor ? "label" : "p";
	return (
		<div className="grid gap-x-8 gap-y-2 border-t border-line-2 py-5 first:border-t-0 first:pt-0 last:pb-0 @min-[640px]:grid-cols-[180px_minmax(0,1fr)]">
			{/* Next to a field, the label lines up with the field's text. */}
			<Label htmlFor={labelFor} className={`text-[14px] leading-[1.3] font-semibold text-ink ${labelFor ? "@min-[640px]:pt-[13px]" : "@min-[640px]:pt-[3px]"}`}>
				{label}
			</Label>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

// The plan's status as a pill with a dot (design system §4: status pill): ink for fine, gap-ink for something to
// fix, faint for over. The words are always there.
export function StatusBadge({ badge }: { badge: Badge }) {
	return (
		<span
			className={`inline-flex min-h-7 flex-none items-center gap-2 rounded-md border px-2.5 font-mono text-[12.5px] leading-none ${badge.tone === "warn" ? "border-gap-ink text-gap-ink" : "border-line bg-sheet text-ink"}`}
		>
			<i
				className={`size-2 flex-none rounded-full ${badge.tone === "ok" ? "bg-ink" : badge.tone === "warn" ? "bg-gap-ink" : "bg-ink-faint"}`}
				aria-hidden="true"
			/>
			{badge.label}
		</span>
	);
}

// What a card says when its data failed to load, with a retry.
export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div role="alert" className="flex flex-col items-start gap-3">
			<p className="text-[15px] text-gap-ink">✕ {message}</p>
			<button type="button" className="btn ghost" onClick={onRetry}>
				Try again
			</button>
		</div>
	);
}
