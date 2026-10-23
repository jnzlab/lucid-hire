import { type JobStatus, STATUS_LABEL } from "../lib/jobs.ts";

// Dot styles per status: open is a filled ink dot, draft an outline, closed a faint dot. The word is always there,
// so the colour is never the only signal.
const DOT: Record<JobStatus, string> = {
	draft: "border-[1.5px] border-ink-muted",
	open: "bg-ink",
	closed: "bg-ink-faint",
};

// A job's status in words with a dot beside it: "● Open".
export function StatusTag({ status, className = "" }: { status: JobStatus; className?: string }) {
	return (
		<span
			className={`inline-flex min-h-7 flex-none items-center gap-2 rounded-md border border-line bg-sheet px-2.5 font-mono text-[12.5px] leading-none ${status === "open" ? "text-ink" : "text-ink-muted"} ${className}`}
		>
			<i className={`size-2 flex-none rounded-full ${DOT[status]}`} aria-hidden="true" />
			{STATUS_LABEL[status]}
		</span>
	);
}
