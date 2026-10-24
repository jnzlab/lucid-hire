import type { KeyboardEvent, MouseEvent } from "react";
import { CandidateTags } from "../../candidates/candidate-tags.tsx";
import { NoteMark } from "../../components/icons.tsx";
import {
	type CandidateSummary,
	SLOW_CHECK_MS,
	candidateName,
	failureMessage,
	isSlow,
	isWorking,
	useRetryCandidate,
} from "../../lib/candidates.ts";
import { useNow } from "../../lib/use-now.ts";
import { Checkbox } from "../../ui/checkbox.tsx";
import { DecisionTag } from "../../ui/decision-tag.tsx";
import { TweenedNumber } from "../../ui/tweened-number.tsx";
import { EvidenceSquares } from "./evidence-squares.tsx";
import { MoveMark } from "./move-mark.tsx";

// A plain left click, as opposed to one that opens a new tab or window.
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

// One compact row of the ranked list: the bulk checkbox, then a link holding the rank, the name, the headline, a
// square per requirement, the evidence chips, the decision and the score. The best match sits on the marker band
// (design system §3); its ring belongs to the detail pane, not the list. The selected row has a 3px ink bar and the
// paper-2 fill, and says so to screen readers with aria-current. A CV still being read, or one that failed, says so
// where the headline would be, and one that can be scored again has Retry beside the link (Re-read for a CV scored
// before the job had requirements). Right after a re-rank, a row that moved shows ↑n or ↓n and its score counts to
// the new one.
export function CandidateRow({
	jobId,
	candidate,
	href,
	selected,
	checked,
	onCheck,
	onCheckRange,
	onActivate,
	onOpen,
	move,
	fresh = false,
}: {
	jobId: string;
	candidate: CandidateSummary;
	href: string;
	selected: boolean;
	checked: boolean;
	onCheck: () => void;
	onCheckRange: () => void;
	// A plain click: select it in the split view, open it on a narrow screen.
	onActivate: () => void;
	// Enter on the row in the split view: open the full candidate page.
	onOpen: (() => void) | null;
	// Places moved in the last re-rank (+2 is up two), shown while `fresh`.
	move?: number;
	fresh?: boolean;
}) {
	const { rank } = candidate;
	const top = rank === 1;
	const name = candidateName(candidate);
	// Not a fit: the name and score go grey, which keeps its contrast on the sheet and on the marker band.
	const muted = candidate.decision === "rejected";

	return (
		<li className={`relative grid grid-cols-[44px_minmax(0,1fr)_auto] items-start ${top ? "rank-band" : ""} ${selected ? "bg-paper-2" : ""}`}>
			{selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-ink" aria-hidden="true" />}
			<Checkbox
				hideLabel
				label={`Select ${name}`}
				checked={checked}
				onCheckedChange={onCheck}
				onClick={(event) => {
					// Shift+click checks or unchecks every row from the last one clicked.
					if (!event.shiftKey) return;
					event.preventDefault();
					onCheckRange();
				}}
				className="ml-1 mt-[10px] self-start"
			/>
			<a
				href={href}
				data-row={candidate.id}
				aria-current={selected ? "true" : undefined}
				onClick={(event) => {
					if (!plainClick(event)) return;
					event.preventDefault();
					onActivate();
				}}
				onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => {
					if (!onOpen || event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					event.preventDefault();
					onOpen();
				}}
				className="group grid min-h-16 min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-[3px] py-2.5 pr-3 focus-visible:outline-offset-[-3px]"
			>
				<span className={`pt-[3px] font-mono text-[12px] leading-[1.3] tabular-nums ${top ? "" : "text-ink-faint"}`} aria-hidden="true">
					{rank ?? "–"}
				</span>
				<span className="flex min-w-0 flex-col gap-1">
					{/* On a narrow row the decision drops under the name rather than squeezing it. */}
					<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span
							className={`max-w-full min-w-0 truncate text-[16px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%] group-hover:underline group-hover:underline-offset-[.18em] ${muted ? "text-ink-muted" : ""}`}
						>
							{rank !== null && <span className="sr-only">Rank {rank}:</span>}{" "}
							{name}
						</span>
						<MoveMark move={move} fresh={fresh} />
						{candidate.hasNote && (
							<span className="inline-flex flex-none text-ink-muted">
								<NoteMark />
								<span className="sr-only">Has a note</span>
							</span>
						)}
						<DecisionTag decision={candidate.decision} />
					</span>
					<Detail candidate={candidate} top={top} />
					<Requirements candidate={candidate} muted={muted} />
					{candidate.status === "scored" && (
						<CandidateTags
							matches={candidate.matches.slice(0, 2)}
							gaps={candidate.gaps.slice(0, 1)}
							className={`gap-x-2.5 gap-y-1 ${muted ? "opacity-75" : ""}`}
						/>
					)}
				</span>
				{candidate.status === "scored" && candidate.score !== null && (
					<span className={`self-center font-display text-[30px] leading-none font-[800] tabular-nums [font-stretch:62%] ${muted ? "text-ink-muted" : ""}`}>
						<span className="sr-only">Score</span> <TweenedNumber value={candidate.score} />
					</span>
				)}
			</a>
			{candidate.canRetry ? <RetryButton jobId={jobId} candidate={candidate} /> : <span />}
		</li>
	);
}

// The line under the name: the headline once scored, otherwise what is happening to the CV. On the marker band the
// text is on-marker, as it is on every mark.
function Detail({ candidate, top }: { candidate: CandidateSummary; top: boolean }) {
	const line = `block truncate font-mono text-[12px] leading-[1.3] ${top ? "text-on-marker" : "text-ink-muted"}`;
	if (isWorking(candidate)) return <Reading candidate={candidate} line={line} />;
	if (candidate.status === "failed") {
		return <span className="block font-mono text-[12px] leading-[1.3] text-gap-ink [overflow-wrap:anywhere]">✕ {failureMessage(candidate)}</span>;
	}
	// Without a headline, the file name helps tell apart a CV that has a name; one without shows it as its name already.
	const text = candidate.headline || (candidate.name ? candidate.fileName : null);
	return text ? <span className={line}>{text}</span> : null;
}

// A square per requirement in the job's order, with "Checking" while a Check all reads the CV again. A CV scored
// before the job had requirements has no squares; it says so instead, beside its Re-read.
function Requirements({ candidate, muted }: { candidate: CandidateSummary; muted: boolean }) {
	if (candidate.status !== "scored") return null;
	if (candidate.scoredBeforeRequirements) {
		return (
			<span className="self-start rounded-md border border-line bg-paper-2 px-2 py-0.5 font-mono text-[11.5px] leading-[1.4] text-ink-2">
				Scored before requirements were set
			</span>
		);
	}
	if (candidate.checks.length === 0 && !candidate.checking) return null;
	return (
		<span className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${muted ? "opacity-75" : ""}`}>
			<EvidenceSquares checks={candidate.checks} />
			{candidate.checking && (
				<span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] leading-[1.3] text-ink-muted">
					<span className="live-dot" aria-hidden="true" />
					Checking…
				</span>
			)}
		</span>
	);
}

// Only mounted while the CV is being read, so the clock that decides "taking longer than usual" ticks only then.
function Reading({ candidate, line }: { candidate: CandidateSummary; line: string }) {
	const now = useNow(SLOW_CHECK_MS);
	return (
		<>
			<span className={`${line} flex items-center gap-2`}>
				<span className="live-dot" aria-hidden="true" />
				Reading the CV
			</span>
			{isSlow(candidate, now) && <span className={line}>This is taking longer than usual.</span>}
		</>
	);
}

// Scores a failed (or stuck) CV again, or reads one scored before the job had requirements against them. Each row
// keeps its own state; while it runs the button only looks disabled, so it keeps keyboard focus, and the click is
// ignored.
function RetryButton({ jobId, candidate }: { jobId: string; candidate: CandidateSummary }) {
	const retry = useRetryCandidate(jobId);
	const reread = candidate.scoredBeforeRequirements;
	const label = retry.isPending ? (reread ? "Re-reading" : "Retrying") : reread ? "Re-read" : "Retry";
	return (
		<div className="flex flex-col items-end gap-1 py-3 pr-3">
			<button
				type="button"
				className="btn ghost xs pointer-coarse:min-h-11"
				aria-label={`${label} ${candidateName(candidate)}`}
				aria-disabled={retry.isPending}
				onClick={() => {
					if (!retry.isPending) retry.mutate(candidate.id);
				}}
			>
				{label}
			</button>
			{retry.isError && (
				<p role="alert" className="max-w-[180px] text-right text-[13px] text-gap-ink">
					✕ {retry.error.message}
				</p>
			)}
		</div>
	);
}
