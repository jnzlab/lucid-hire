import { useRef } from "react";
import { ROW_ACTION } from "../../candidates/row-action.ts";
import { type CandidateSummary, candidateName } from "../../lib/candidates.ts";
import { AppLink } from "../../ui/app-link.tsx";
import { TweenedNumber } from "../../ui/tweened-number.tsx";
import { EvidenceKey, EvidenceSquares } from "./evidence-squares.tsx";
import { MoveMark } from "./move-mark.tsx";
import { useFlip } from "./use-flip.ts";
import type { MovesState } from "./use-moves.ts";
import { candidatePath } from "./view.ts";

// The scored CVs shown beside the requirements; the rest are a click away on the Candidates tab.
const RANKING_ROWS = 10;

// The job's scored CVs, best first, beside the requirements, so a change of weight shows its effect where it is made
// (design system §9.5): the rows slide to their new places, the ones that moved say ↑n or ↓n for a moment and the
// scores count to their new values. The sentence on top says who leads, and is read out when that changes.
export function LiveRanking({
	jobId,
	list,
	moves,
	onShowAll,
}: {
	jobId: string;
	list: CandidateSummary[];
	moves: MovesState;
	onShowAll: () => void;
}) {
	const scored = list.filter(({ status }) => status === "scored");
	const shown = scored.slice(0, RANKING_ROWS);
	const listRef = useRef<HTMLOListElement>(null);
	useFlip(listRef, shown.map(({ id }) => id).join(" "));
	const leader = scored[0];

	return (
		<section aria-labelledby="ranking-h" className="flex min-w-0 flex-col rounded-xl bg-sheet shadow-card">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 px-4 pt-4 pb-3">
				<h2 id="ranking-h" className="text-[17px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Ranking
				</h2>
				<p className="font-mono text-[12px] text-ink-muted">
					{scored.length} scored · no AI to re-rank
				</p>
			</div>
			<p aria-live="polite" className="px-4 pt-3 pb-1 text-[15px] text-ink-2">
				{!leader
					? "Scored CVs show here, best first."
					: leader.score === null
						? "Turn on at least one requirement to rank the CVs."
						: `${candidateName(leader)} leads with ${leader.score}.`}
			</p>
			{shown.length > 0 && (
				<ol ref={listRef} aria-label="Ranking" className="divide-y divide-line-2">
					{shown.map((row) => (
						<RankingRow key={row.id} jobId={jobId} row={row} move={moves.moves.get(row.id)} fresh={moves.fresh} />
					))}
				</ol>
			)}
			{scored.length > shown.length && (
				<div className="border-t border-line-2 px-4 py-2">
					<button type="button" className={ROW_ACTION} onClick={onShowAll}>
						See all {scored.length} on the Candidates tab
					</button>
				</div>
			)}
			<EvidenceKey className="border-t border-line-2 px-4 py-3" />
		</section>
	);
}

// One CV: rank, name (with ↑n or ↓n just after a re-rank), its squares in the order of the requirements, and the score
// in condensed numerals. The leader sits on the marker band, as on the Candidates tab.
function RankingRow({ jobId, row, move, fresh }: { jobId: string; row: CandidateSummary; move?: number; fresh: boolean }) {
	const top = row.rank === 1;
	return (
		<li
			data-flip={row.id}
			className={`relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 bg-sheet px-4 py-2.5 ${top ? "rank-band" : ""}`}
		>
			<span aria-hidden="true" className={`font-mono text-[12px] tabular-nums ${top ? "" : "text-ink-faint"}`}>
				{row.rank ?? "–"}
			</span>
			<span className="flex min-w-0 flex-col gap-1">
				<span className="flex min-w-0 items-center gap-2">
					<AppLink
						href={candidatePath(jobId, row.id)}
						className="min-w-0 truncate rounded-[3px] text-[15px] leading-[1.25] font-[750] [font-stretch:104%] hover:underline hover:underline-offset-[.18em]"
					>
						{row.rank !== null && <span className="sr-only">Rank {row.rank}:</span>} {candidateName(row)}
					</AppLink>
					<MoveMark move={move} fresh={fresh} />
				</span>
				{row.scoredBeforeRequirements ? (
					<span className={`font-mono text-[11.5px] ${top ? "text-on-marker" : "text-ink-muted"}`}>
						Scored before requirements were set
					</span>
				) : (
					<EvidenceSquares checks={row.checks} />
				)}
			</span>
			<span className="font-display text-[26px] leading-none font-[800] tabular-nums [font-stretch:62%]">
				{row.score === null ? (
					<>
						<span className="sr-only">No score</span>
						<span aria-hidden="true">–</span>
					</>
				) : (
					<>
						<span className="sr-only">Score</span> <TweenedNumber value={row.score} />
					</>
				)}
			</span>
		</li>
	);
}
