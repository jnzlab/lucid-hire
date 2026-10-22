import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { type JobStatus, STATUS_LABEL } from "../lib/jobs.ts";

// Draft, open or closed, in words with a dot beside them, so the colour is never the only signal.
const DOT: Record<JobStatus, string> = {
	draft: "border-[1.5px] border-ink-muted",
	open: "bg-ink",
	closed: "bg-ink-faint",
};

export function JobStatusTag({ status }: { status: JobStatus }) {
	return (
		<span
			className={`inline-flex min-h-7 items-center gap-2 rounded-md border border-line bg-sheet px-2.5 font-mono text-[12.5px] ${status === "open" ? "text-ink" : "text-ink-muted"}`}
		>
			<i className={`size-2 rounded-full ${DOT[status]}`} aria-hidden="true" />
			{STATUS_LABEL[status]}
		</span>
	);
}

// The heading block every dashboard page starts with: an eyebrow label, the page title and actions. The
// title takes focus when the page appears, so a keyboard or screen reader user starts at the top of the new page.
export function PageHeading({
	eyebrow,
	title,
	actions,
	children,
}: {
	eyebrow: ReactNode;
	title: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	const titleRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		titleRef.current?.focus();
	}, []);

	return (
		<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
			<div className="min-w-0">
				<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{eyebrow}</p>
				{/* Focused from code, not by a click or Tab, so it gets no ring. */}
				<h1
					ref={titleRef}
					tabIndex={-1}
					className="mt-2 font-display text-[clamp(32px,4vw,52px)] leading-[.98] font-[820] tracking-[-0.038em] [overflow-wrap:anywhere] [font-stretch:112%] focus:outline-none"
				>
					{title}
				</h1>
				{children}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
		</header>
	);
}

export function BackToJobs() {
	return (
		<Link
			to="/dashboard/jobs"
			className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-[3px] font-mono text-[13px] text-ink-muted hover:text-ink"
		>
			<span aria-hidden="true">←</span> Jobs
		</Link>
	);
}

// The way back from a candidate to the job it was uploaded to.
export function BackToJob({ jobId, title }: { jobId: string; title?: string }) {
	return (
		<Link
			to="/dashboard/jobs/$jobId"
			params={{ jobId }}
			className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-[3px] font-mono text-[13px] text-ink-muted [overflow-wrap:anywhere] hover:text-ink"
		>
			<span aria-hidden="true">←</span> {title ?? "Job"}
		</Link>
	);
}

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
