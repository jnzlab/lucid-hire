import { Link, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, type PointerEvent, type Ref, useRef } from "react";
import type { AllCandidate, AllCandidateSort } from "../lib/all-candidates.ts";
import { candidateName, isWorking, SLOW_READ_MS } from "../lib/candidates.ts";
import { formatRelative } from "../lib/format.ts";
import type { Selection } from "../candidates/use-selection.ts";
import { NoteMark } from "../components/icons.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { DecisionTag } from "../ui/decision-tag.tsx";

type ListProps = {
	rows: AllCandidate[];
	selection: Selection;
	sort: AllCandidateSort;
	now: number;
	// Holds the "select all" checkbox, where focus goes back after a bulk action.
	selectAllRef: Ref<HTMLSpanElement>;
	// False while the list is filtered to one job, where every row would name the same job.
	showJob?: boolean;
};

const SOURCE_LABEL: Record<AllCandidate["source"], string> = { apply: "Applied", upload: "Uploaded" };
const CANDIDATE_ROUTE = "/dashboard/jobs/$jobId/candidates/$candidateId";
// Tells the candidate page its way back is this list, not the job.
const FROM_LIST = { from: "candidates" } as const;

// Shift+click on a checkbox checks the run of rows since the last one. The checkbox only reports its new state, so
// the shift key is read from the pointer press that started the click.
function useRangeClick(selection: Selection) {
	const shift = useRef(false);
	return {
		onPointerDownCapture: (event: PointerEvent) => {
			shift.current = event.shiftKey;
		},
		toggle: (id: string) => {
			if (shift.current && selection.toggleRange) selection.toggleRange(id);
			else selection.toggle(id);
			shift.current = false;
		},
	};
}

// The checked rows' count for the header checkbox's name, so a screen reader hears what it will do.
const selectAllLabel = (selection: Selection, count: number) =>
	selection.allChecked ? `Unselect all ${count} candidates on this page` : `Select all ${count} candidates on this page`;

// The score as the condensed numeral (design system §2.2), or a dash until there is one.
function Score({ row, className = "" }: { row: AllCandidate; className?: string }) {
	if (row.score === null) {
		return (
			<span className={`font-display text-[22px] leading-none text-ink-faint ${className}`}>
				<span aria-hidden="true">–</span>
				<span className="sr-only">No score yet</span>
			</span>
		);
	}
	return (
		<span
			className={`font-display text-[30px] leading-none font-[800] tracking-[-0.02em] tabular-nums [font-stretch:62%] ${row.decision === "rejected" ? "text-ink-muted" : "text-ink"} ${className}`}
		>
			<span className="sr-only">Score</span>{" "}
			{row.score}
		</span>
	);
}

// Where the CV is: being read (live dot, and "slow" when it takes longer than usual), couldn't be read (✕ in words)
// or scored.
function Status({ row, now }: { row: AllCandidate; now: number }) {
	if (isWorking(row)) {
		return (
			<span className="inline-flex items-center gap-2 text-ink">
				<span className="live-dot" aria-hidden="true" />
				{now - Date.parse(row.createdAt) > SLOW_READ_MS ? "Reading · slow" : "Reading"}
			</span>
		);
	}
	if (row.status === "failed") return <span className="text-gap-ink">✕ Couldn't read</span>;
	return <span className="text-ink-2">Scored</span>;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

// How the CV came in and when: "Applied 2 h ago", "Uploaded yesterday", "Uploaded 13 Oct" (with the year when it
// isn't this year's), short enough for one line of the table.
function received(row: AllCandidate, now: number) {
	const then = new Date(row.createdAt);
	let when = formatRelative(row.createdAt, now);
	if (/\d{4}$/.test(when) && then.getFullYear() === new Date(now).getFullYear()) when = DAY_MONTH.format(then);
	return `${SOURCE_LABEL[row.source]} ${/^\d/.test(when) ? when : when.charAt(0).toLowerCase() + when.slice(1)}`;
}

// "To review" for a scored CV nobody has decided on, else the decision tag (nothing for an unread, undecided CV).
function Decision({ row }: { row: AllCandidate }) {
	if (row.decision !== "undecided") return <DecisionTag decision={row.decision} />;
	if (row.status !== "scored") return <span className="sr-only">Undecided</span>;
	return <span className="font-mono text-[12.5px] whitespace-nowrap text-ink-2">To review</span>;
}

function NameAndHeadline({ row, stretch = false }: { row: AllCandidate; stretch?: boolean }) {
	const name = candidateName(row);
	return (
		<span className="block min-w-0">
			<span className="flex min-w-0 items-center gap-2">
				<Link
					to={CANDIDATE_ROUTE}
					params={{ jobId: row.jobId, candidateId: row.id }}
					search={FROM_LIST}
					className={`min-w-0 truncate text-[16px] leading-[1.25] font-[800] tracking-[-0.01em] no-underline [font-stretch:108%] hover:underline hover:underline-offset-[.18em] ${row.decision === "rejected" ? "text-ink-muted" : "text-ink"} ${stretch ? "after:absolute after:inset-0 after:content-['']" : ""}`}
				>
					{name}
				</Link>
				{row.hasNote && (
					<span className="inline-flex flex-none text-ink-muted">
						<NoteMark />
						<span className="sr-only">Has a note</span>
					</span>
				)}
			</span>
			{(row.headline || row.name) && (
				<span className="mt-1 block truncate font-mono text-[12px] leading-[1.3] text-ink-muted">{row.headline ?? row.fileName}</span>
			)}
		</span>
	);
}

function JobLink({ row, className = "" }: { row: AllCandidate; className?: string }) {
	return (
		<Link
			to="/dashboard/jobs/$jobId"
			params={{ jobId: row.jobId }}
			className={`truncate text-ink-2 underline decoration-line underline-offset-[.18em] hover:text-ink hover:decoration-ink ${className}`}
		>
			{row.jobTitle}
		</Link>
	);
}

const SORTED_COLUMN: Record<AllCandidateSort, { column: "name" | "job" | "score" | "received"; order: "ascending" | "descending" }> = {
	score: { column: "score", order: "descending" },
	newest: { column: "received", order: "descending" },
	name: { column: "name", order: "ascending" },
	job: { column: "job", order: "ascending" },
};

// The desktop list: a table with a checkbox column, the name and headline, the job, the score, the decision, the
// CV's status, and how and when it came in. A click anywhere on a row opens the candidate; the
// name is the link keyboards and screen readers use.
export function CandidateTable({ rows, selection, sort, now, selectAllRef, showJob = true }: ListProps) {
	const navigate = useNavigate();
	const range = useRangeClick(selection);
	const sorted = SORTED_COLUMN[sort];
	const ariaSort = (column: (typeof sorted)["column"]) => (sorted.column === column ? sorted.order : undefined);
	const head = "px-3 py-3 text-left font-mono text-[12px] font-normal tracking-[.08em] text-ink-muted uppercase";

	const open = (event: MouseEvent<HTMLTableRowElement>, row: AllCandidate) => {
		const target = event.target as Element;
		if (target.closest("a, button, input, label") || window.getSelection()?.toString()) return;
		void navigate({ to: CANDIDATE_ROUTE, params: { jobId: row.jobId, candidateId: row.id }, search: FROM_LIST });
	};

	return (
		<div className="overflow-hidden rounded-xl bg-sheet shadow-card">
			<table className="w-full table-fixed border-collapse text-[15px]">
				<caption className="sr-only">Candidates across your jobs</caption>
				<thead className="border-b border-line">
					<tr>
						<th scope="col" className="w-14 py-1 pl-2">
							<span ref={selectAllRef} className="flex">
								<Checkbox
									label={selectAllLabel(selection, rows.length)}
									hideLabel
									checked={selection.allChecked}
									indeterminate={selection.someChecked}
									onCheckedChange={selection.toggleAll}
								/>
							</span>
						</th>
						<th scope="col" aria-sort={ariaSort("name")} className={head}>
							Candidate
						</th>
						{showJob && (
							<th scope="col" aria-sort={ariaSort("job")} className={`${head} w-[20%]`}>
								Job
							</th>
						)}
						<th scope="col" aria-sort={ariaSort("score")} className={`${head} w-16 text-right`}>
							Score
						</th>
						<th scope="col" className={`${head} w-[116px]`}>
							Decision
						</th>
						<th scope="col" className={`${head} w-[120px]`}>
							Status
						</th>
						<th scope="col" aria-sort={ariaSort("received")} className={`${head} w-[150px]`}>
							Received
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const checked = selection.selected.has(row.id);
						return (
							<tr
								key={row.id}
								onClick={(event) => open(event, row)}
								className={`cursor-pointer border-b border-line-2 last:border-b-0 hover:bg-paper-2 ${checked ? "bg-paper-2" : ""}`}
							>
								<td
									className="py-1 pl-2 align-middle select-none"
									onClick={(event) => event.stopPropagation()}
									onPointerDownCapture={range.onPointerDownCapture}
								>
									<Checkbox
										label={`Select ${candidateName(row)}`}
										hideLabel
										checked={checked}
										onCheckedChange={() => range.toggle(row.id)}
									/>
								</td>
								<td className="min-w-0 px-3 py-3 align-middle">
									<NameAndHeadline row={row} />
								</td>
								{showJob && (
									<td className="px-3 py-3 align-middle">
										<span className="flex min-w-0">
											<JobLink row={row} className="text-[14.5px]" />
										</span>
									</td>
								)}
								<td className="px-3 py-3 text-right align-middle">
									<Score row={row} />
								</td>
								<td className="px-3 py-3 align-middle">
									<Decision row={row} />
								</td>
								<td className="px-3 py-3 align-middle font-mono text-[12.5px]">
									<Status row={row} now={now} />
								</td>
								<td className="px-3 py-3 align-middle font-mono text-[12.5px] text-ink-muted">{received(row, now)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

// The phone and tablet list: one card per candidate, the whole card a link to them, with the checkbox (and the job
// link) above that link so they work on their own. A "select all" row heads the list.
export function CandidateCards({ rows, selection, now, selectAllRef, showJob = true }: ListProps) {
	const range = useRangeClick(selection);
	return (
		<div className="overflow-hidden rounded-xl bg-sheet shadow-card">
			<div className="flex items-center border-b border-line px-2">
				<span ref={selectAllRef} className="flex">
					<Checkbox
						label={<span className="text-[14px] font-[600]">Select all on this page</span>}
						checked={selection.allChecked}
						indeterminate={selection.someChecked}
						onCheckedChange={selection.toggleAll}
					/>
				</span>
			</div>
			<ul aria-label="Candidates across your jobs">
				{rows.map((row) => {
					const checked = selection.selected.has(row.id);
					return (
						<li
							key={row.id}
							className={`relative flex items-start gap-1 border-b border-line-2 py-2 pr-4 pl-2 last:border-b-0 hover:bg-paper-2 ${checked ? "bg-paper-2" : ""}`}
						>
							<span className="relative z-10 flex-none select-none" onPointerDownCapture={range.onPointerDownCapture}>
								<Checkbox label={`Select ${candidateName(row)}`} hideLabel checked={checked} onCheckedChange={() => range.toggle(row.id)} />
							</span>
							<div className="min-w-0 flex-1 py-2">
								<div className="flex items-start gap-3">
									<div className="min-w-0 flex-1">
										<NameAndHeadline row={row} stretch />
									</div>
									<Score row={row} className="flex-none" />
								</div>
								<div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[12.5px] text-ink-muted">
									{showJob && (
										<span className="relative z-10 flex min-w-0 max-w-full">
											<JobLink row={row} className="font-sans text-[14px]" />
										</span>
									)}
									<Decision row={row} />
									<span className="inline-flex flex-wrap items-center gap-x-2">
										<Status row={row} now={now} />
										<span aria-hidden="true">·</span>
										<span>{received(row, now)}</span>
									</span>
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
