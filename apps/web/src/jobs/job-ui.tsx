import type { ReactNode } from "react";

// In-page states, as the status pill (design system §4). The app shell stays around them. A `page` state
// stands in for the whole page, so it carries the page's h1 for screen readers.
export function SectionLoading({ label, page = false }: { label: string; page?: boolean }) {
	return (
		<>
			{page && <h1 className="sr-only">{label}</h1>}
			<p
				role="status"
				className="inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card"
			>
				<span className="live-dot" aria-hidden="true" />
				{label}
			</p>
		</>
	);
}

// `level` is 1 when the error is the whole page, 2 when it sits in a page that has its own h1.
export function SectionError({
	title,
	message,
	action,
	level = 2,
}: {
	title: string;
	message: string;
	action: ReactNode;
	level?: 1 | 2;
}) {
	const Heading = level === 1 ? "h1" : "h2";
	return (
		<div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
			<Heading className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				<span className="mk mk-gap">✕ {title}</span>
			</Heading>
			<p className="text-[15px] text-ink-2">{message}</p>
			{action}
		</div>
	);
}
