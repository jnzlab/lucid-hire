import { ArrowDownUp, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { formatNumber } from "../lib/format.ts";
import { useHotkeys } from "../lib/hotkeys.ts";
import {
	ALL_CANDIDATE_SORT_LABEL,
	ALL_CANDIDATE_SORTS,
	type AllCandidateSort,
	type AllCandidatesCounts,
	type AllCandidatesFilters,
	CANDIDATE_SEARCH_MAX,
	DECISION_FILTER_LABEL,
	type DecisionFilter,
	MIN_SCORES,
	STATUS_FILTER_LABEL,
	STATUS_FILTERS,
	type StatusFilter,
	isFilteredView,
} from "../lib/all-candidates.ts";
import { HOVER_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { Kbd } from "../ui/kbd.tsx";
import { type Segment, SegmentedControl } from "../ui/segmented-control.tsx";
import { FilterMenu } from "./filter-menu.tsx";
import { JobPicker } from "./job-picker.tsx";

const SEARCH_DEBOUNCE_MS = 300;
// The decisions the page offers. "Undecided" only appears when a link asks for it.
const DECISION_SEGMENTS: DecisionFilter[] = ["all", "review", "shortlisted", "rejected"];
const STATUS_OPTIONS = STATUS_FILTERS.map((value) => ({ value, label: STATUS_FILTER_LABEL[value] }));
const SCORE_OPTIONS = [
	{ value: "any", label: "Any score" },
	...MIN_SCORES.map((score) => ({ value: String(score), label: `Score ${score}+` })),
] as const;
const SORT_OPTIONS = ALL_CANDIDATE_SORTS.map((value) => ({ value, label: ALL_CANDIDATE_SORT_LABEL[value] }));

const clean = (value: string) => value.trim().replace(/\s+/g, " ");

// Search, job, decision, status, minimum score and sort, all kept in the address (`?q=&jobId=&decision=&status=
// &minScore=&sort=`), so a filtered list can be bookmarked, shared and reached with Back. Changing any of them goes
// back to the first page. Typing waits a moment before it searches; `/` jumps to the field.
export function Toolbar({
	filters,
	counts,
	jobTitle,
	shown,
	onChange,
}: {
	filters: AllCandidatesFilters;
	// How many candidates each decision has under the other filters; missing while the first page loads.
	counts: AllCandidatesCounts | undefined;
	jobTitle: string | undefined;
	// "Showing 1–50 of 212", read out when it changes.
	shown: ReactNode;
	onChange: (patch: Partial<AllCandidatesFilters>, options?: { replace?: boolean }) => void;
}) {
	const decisionId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const hover = useMediaQuery(HOVER_QUERY);
	const [text, setText] = useState(filters.q ?? "");
	const sent = useRef(filters.q ?? "");
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	// The address changed from outside (Back, Clear filters): the field follows it.
	useEffect(() => {
		const q = filters.q ?? "";
		if (q !== sent.current) {
			sent.current = q;
			setText(q);
		}
	}, [filters.q]);
	useEffect(() => () => clearTimeout(timer.current), []);

	useHotkeys([
		{
			keys: "/",
			label: "Search candidates",
			group: "Lists",
			run: (event) => {
				event.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			},
		},
	]);

	const search = (value: string) => {
		clearTimeout(timer.current);
		const q = clean(value);
		if (q === sent.current) return;
		sent.current = q;
		onChange({ q: q || undefined }, { replace: true });
	};
	const clearFilters = () => {
		clearTimeout(timer.current);
		sent.current = "";
		setText("");
		onChange({ q: undefined, jobId: undefined, decision: undefined, status: undefined, minScore: undefined });
		// The button goes once nothing is filtered; focus moves to the decision filter, now on All.
		rootRef.current?.querySelector<HTMLInputElement>('input[name="candidate-decision"][value="all"]')?.focus();
	};

	const decision: DecisionFilter = filters.decision ?? "all";
	const segments: Segment<DecisionFilter>[] = [...DECISION_SEGMENTS, ...(decision === "undecided" ? (["undecided"] as const) : [])].map(
		(value) => ({
			value,
			label: (
				<>
					{DECISION_FILTER_LABEL[value]}
					{/* The space keeps "To review 25" two words for screen readers; the flex gap draws it. */}
					{counts && " "}
					{counts && <span className="tabular-nums opacity-75">{formatNumber(counts[value])}</span>}
				</>
			),
		}),
	);

	return (
		<div ref={rootRef} role="search" aria-label="Filter candidates" className="@container flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<span id={decisionId} className="sr-only">
					Decision
				</span>
				<SegmentedControl
					name="candidate-decision"
					labelledBy={decisionId}
					value={decision}
					segments={segments}
					compact
					// On a phone the four segments wrap unevenly, so they sit in two even columns instead.
					className="@max-md:grid @max-md:w-full @max-md:grid-cols-2 @max-md:[&>label>span]:w-full"
					onChange={(value) => onChange({ decision: value === "all" ? undefined : value })}
				/>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<p role="status" className="font-mono text-[13px] text-ink-muted">
						{shown}
					</p>
					{isFilteredView(filters) && (
						<button type="button" className="min-h-11 text-[15px] font-[650] underline underline-offset-[.18em]" onClick={clearFilters}>
							Clear filters
						</button>
					)}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<form
					className="relative w-full min-w-0 @4xl:w-auto @4xl:flex-1"
					onSubmit={(event) => {
						event.preventDefault();
						search(text);
					}}
				>
					<label htmlFor="candidate-search" className="sr-only">
						Search candidates
					</label>
					<Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
					<input
						ref={inputRef}
						id="candidate-search"
						type="search"
						className="field pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
						placeholder="Search name, email, headline or file"
						maxLength={CANDIDATE_SEARCH_MAX}
						autoComplete="off"
						aria-keyshortcuts="/"
						value={text}
						onChange={(event) => {
							setText(event.target.value);
							clearTimeout(timer.current);
							const value = event.target.value;
							timer.current = setTimeout(() => search(value), SEARCH_DEBOUNCE_MS);
						}}
					/>
					{text ? (
						<button
							type="button"
							aria-label="Clear the search"
							className="absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-md text-ink-muted hover:text-ink"
							onClick={() => {
								setText("");
								search("");
								inputRef.current?.focus();
							}}
						>
							<X size={18} aria-hidden="true" />
						</button>
					) : (
						hover && <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">/</Kbd>
					)}
				</form>
				<JobPicker jobId={filters.jobId} knownTitle={jobTitle} onChange={(jobId) => onChange({ jobId })} />
				<FilterMenu<StatusFilter>
					label="Status"
					value={filters.status ?? "any"}
					options={STATUS_OPTIONS}
					active={Boolean(filters.status)}
					onChange={(status) => onChange({ status: status === "any" ? undefined : status })}
				/>
				<FilterMenu
					label="Minimum score"
					value={filters.minScore ? String(filters.minScore) : "any"}
					options={SCORE_OPTIONS}
					active={Boolean(filters.minScore)}
					onChange={(score) => onChange({ minScore: MIN_SCORES.find((value) => String(value) === score) })}
				/>
				<FilterMenu<AllCandidateSort>
					label="Sort"
					icon={<ArrowDownUp size={16} aria-hidden="true" className="flex-none text-ink-muted" />}
					value={filters.sort ?? "score"}
					options={SORT_OPTIONS}
					active={false}
					onChange={(sort) => onChange({ sort: sort === "score" ? undefined : sort })}
				/>
			</div>
		</div>
	);
}
