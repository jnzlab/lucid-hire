import type { ReactNode } from "react";

// Full-page states while the session or the account loads, as the status pill (design system §4). The sr-only
// h1 gives the page a heading while it waits.
export function PageLoading({ label }: { label: string }) {
	return (
		<div className="grid min-h-dvh place-items-center bg-paper p-4">
			<h1 className="sr-only">{label}</h1>
			<p
				role="status"
				className="inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card"
			>
				<span className="live-dot" aria-hidden="true" />
				{label}
			</p>
		</div>
	);
}

// A full-page error. `action` is the way out (a link, say); without it, `onRetry` gives a Try again button. With both,
// `compact` is for a page that may sit inside the app shell, whose header already takes some of the height.
export function PageError({
	title = "We couldn't load your account",
	message,
	onRetry,
	action,
	reference,
	compact = false,
}: {
	title?: string;
	message: string;
	onRetry?: () => void;
	action?: ReactNode;
	// A short id the recruiter can quote to support; it is also in the console beside the error.
	reference?: string;
	compact?: boolean;
}) {
	return (
		<div className={`grid place-items-center bg-paper p-4 ${compact ? "min-h-[70dvh]" : "min-h-dvh"}`}>
			<div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
				<h1 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					<span className="mk mk-gap">✕ {title}</span>
				</h1>
				<p className="text-[15px] text-ink-2">{message}</p>
				{reference && <p className="font-mono text-[13px] text-ink-muted">Error reference: {reference}</p>}
				{action ??
					(onRetry && (
						<button type="button" className="btn" onClick={onRetry}>
							Try again
						</button>
					))}
			</div>
		</div>
	);
}
