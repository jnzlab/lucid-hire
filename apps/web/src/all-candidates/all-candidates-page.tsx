import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BulkBar } from "../candidates/bulk-bar.tsx";
import { useSelection } from "../candidates/use-selection.ts";
import { useOrg } from "../dashboard/org.ts";
import {
	type AllCandidate,
	type AllCandidatesCounts,
	type AllCandidatesFilters,
	type AllCandidatesList,
	isFilteredView,
	rememberCandidatesView,
	useAllCandidates,
} from "../lib/all-candidates.ts";
import { formatNumber } from "../lib/format.ts";
import { useHotkeys } from "../lib/hotkeys.ts";
import { useJobs } from "../lib/jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { useNow } from "../lib/use-now.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { CandidateCards, CandidateTable } from "./candidate-list.tsx";
import { Toolbar } from "./toolbar.tsx";

// The table needs this much room for its seven columns; a narrower list (a phone, a tablet, a 1024px laptop with the
// sidebar open) is cards.
const TABLE_MIN_WIDTH = 860;
const NO_ROWS: AllCandidate[] = [];

const candidates = (n: number) => `${formatNumber(n)} ${n === 1 ? "candidate" : "candidates"}`;

// The sentence under the heading: the whole company's candidates when nothing narrows the list, else what the
// filters match. The decision filter isn't counted, so the sentence doesn't change as you switch it.
function summaryOf(counts: AllCandidatesCounts, filters: AllCandidatesFilters, jobCount: number | undefined) {
	const review = counts.review > 0 ? ` · ${formatNumber(counts.review)} to review` : "";
	if (isFilteredView({ ...filters, decision: undefined })) return `${candidates(counts.all)} match${counts.all === 1 ? "es" : ""} your filters${review}`;
	if (counts.all === 0) return "No candidates yet";
	const across = jobCount ? ` across ${formatNumber(jobCount)} ${jobCount === 1 ? "job" : "jobs"}` : "";
	return `${candidates(counts.all)}${across}${review}`;
}

// Whether an element is at least `min` pixels wide, kept up to date as it resizes. It goes by the list's own width,
// not the window's, because the sidebar takes 64 or 256px of it. Read while rendering, so a phone never flashes
// the table. Without ResizeObserver (tests) it says yes.
function useWiderThan(element: HTMLElement | null, min: number) {
	const measurable = element !== null && typeof ResizeObserver !== "undefined";
	const subscribe = useCallback(
		(onChange: () => void) => {
			if (!element || typeof ResizeObserver === "undefined") return () => {};
			const observer = new ResizeObserver(onChange);
			observer.observe(element);
			return () => observer.disconnect();
		},
		[element],
	);
	return useSyncExternalStore(
		subscribe,
		() => !measurable || element.getBoundingClientRect().width >= min,
		() => true,
	);
}

// "Showing 1–50 of 212" for the page on screen.
function shownOf({ total, page, pageSize, candidates: rows }: AllCandidatesList) {
	if (total === 0) return "No candidates match";
	const first = (page - 1) * pageSize + 1;
	return `Showing ${formatNumber(first)}–${formatNumber(first + rows.length - 1)} of ${formatNumber(total)}`;
}

// Every candidate across the company's jobs in one list (spec §4.6): search, filter by job, decision, status and
// minimum score, sort, then open one or act on several at once with the bulk bar. Pages of 50 come from the server;
// rows whose CV is still being read refresh on their own.
export function AllCandidatesPage() {
	useDocumentTitle("Candidates · LucidHire");
	const org = useOrg();
	const filters: AllCandidatesFilters = useSearch({ from: "/dashboard/candidates" });
	const navigate = useNavigate({ from: "/dashboard/candidates" });
	const list = useAllCandidates(filters);
	// The jobs most recently active, for the summary's job count and the Job filter's first list (the same query).
	const jobs = useJobs({ sort: "activity" });
	const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
	const wide = useWiderThan(listEl, TABLE_MIN_WIDTH);
	const now = useNow(60_000);

	const rows = list.data?.candidates ?? NO_ROWS;
	const ids = useMemo(() => rows.map(({ id }) => id), [rows]);
	const selection = useSelection(ids);
	const selectedIds = useMemo(() => [...selection.selected], [selection.selected]);
	// The "select all" checkbox, where focus goes when the bulk bar leaves after an action.
	const selectAllRef = useRef<HTMLSpanElement>(null);
	const returnFocus = useMemo(
		() => ({
			get current() {
				return selectAllRef.current?.querySelector<HTMLInputElement>("input") ?? null;
			},
		}),
		[],
	);

	useHotkeys([{ keys: "Escape", label: "Clear the selection", run: selection.clear, enabled: selection.selected.size > 0 }]);

	const change = (patch: Partial<AllCandidatesFilters>, { replace = false }: { replace?: boolean } = {}) =>
		void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }), replace });
	// The empty state's button goes with the empty state, so focus goes to the heading rather than the page's body.
	const leaveEmpty = (patch: Partial<AllCandidatesFilters>) => {
		change(patch);
		document.querySelector<HTMLElement>("main h1[tabindex]")?.focus({ preventScroll: true });
	};
	const goToPage = (page: number) => void navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) });

	// So a candidate opened from here links back to this exact view.
	useEffect(() => rememberCandidatesView(filters), [filters]);

	// A page past the end (its last candidates were deleted, or an old link) goes back to the first.
	useEffect(() => {
		const data = list.data;
		if (data && !list.isPlaceholderData && data.candidates.length === 0 && data.total > 0 && filters.page) {
			void navigate({ search: (prev) => ({ ...prev, page: undefined }), replace: true });
		}
	}, [list.data, list.isPlaceholderData, filters.page, navigate]);

	const jobTitle = filters.jobId
		? (jobs.data?.jobs.find(({ id }) => id === filters.jobId)?.title ?? rows.find(({ jobId }) => jobId === filters.jobId)?.jobTitle)
		: undefined;
	const nothingYet = list.data !== undefined && list.data.counts.all === 0 && !isFilteredView({ ...filters, decision: undefined });

	return (
		<div className="wrap page">
			<PageHeader
				title="Candidates"
				summary={list.data ? summaryOf(list.data.counts, filters, jobs.data?.counts.all) : list.isPending ? <Skeleton className="h-4 w-72 max-w-full" /> : null}
			/>
			<div className="mt-6">
				{list.isError && !list.data ? (
					<div role="alert" className="flex max-w-xl flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
						<h2 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
							<span className="mk mk-gap">✕ We couldn't load your candidates</span>
						</h2>
						<p className="text-[15px] text-ink-2">{list.error.message}</p>
						<button type="button" className="btn" onClick={() => void list.refetch()}>
							Try again
						</button>
					</div>
				) : nothingYet ? (
					<NoCandidatesYet />
				) : (
					<>
						<Toolbar
							filters={filters}
							counts={list.data?.counts}
							jobTitle={jobTitle}
							shown={list.data ? shownOf(list.data) : ""}
							onChange={change}
						/>
						{list.isError && (
							<p role="alert" className="mt-4 text-[14px] text-gap-ink">
								✕ {list.error.message}{" "}
								<button type="button" className="underline underline-offset-[.18em]" onClick={() => void list.refetch()}>
									Try again
								</button>
							</p>
						)}
						<div
							ref={setListEl}
							aria-busy={list.isPending || list.isPlaceholderData}
							className={`mt-4 ${list.isPlaceholderData ? "opacity-60" : ""}`}
						>
							{!list.data ? (
								<ListSkeleton />
							) : list.data.total === 0 ? (
								<NoneMatch
									filters={filters}
									onShowAll={() => leaveEmpty({ decision: undefined })}
									onClear={() => leaveEmpty(CLEARED)}
								/>
							) : (
								<>
									{wide ? (
										<CandidateTable rows={rows} selection={selection} sort={filters.sort ?? "score"} now={now} selectAllRef={selectAllRef} showJob={!filters.jobId} />
									) : (
										<CandidateCards rows={rows} selection={selection} sort={filters.sort ?? "score"} now={now} selectAllRef={selectAllRef} showJob={!filters.jobId} />
									)}
									<BulkBar
										selectedIds={selectedIds}
										onClear={selection.clear}
										isAdmin={org.role === "admin"}
										returnFocus={returnFocus}
										className="mt-3"
									/>
									<Pagination list={list.data} onPage={goToPage} />
								</>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

const CLEARED: Partial<AllCandidatesFilters> = { q: undefined, jobId: undefined, decision: undefined, status: undefined, minScore: undefined };

// Previous and Next under the list, when there is more than one page.
function Pagination({ list, onPage }: { list: AllCandidatesList; onPage: (page: number) => void }) {
	const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
	if (pages <= 1) return null;
	const { page } = list;
	return (
		<nav aria-label="Pages" className="mt-5 flex flex-wrap items-center justify-between gap-3">
			<p className="font-mono text-[13px] text-ink-muted">
				Page {formatNumber(page)} of {formatNumber(pages)}
			</p>
			<div className="flex gap-2">
				{/* At either end the button only looks disabled, so focus stays on it after the last step. */}
				<button
					type="button"
					className="btn ghost"
					aria-disabled={page <= 1}
					onClick={() => {
						if (page > 1) onPage(page - 1);
					}}
				>
					Previous
				</button>
				<button
					type="button"
					className="btn ghost"
					aria-disabled={page >= pages}
					onClick={() => {
						if (page < pages) onPage(page + 1);
					}}
				>
					Next
				</button>
			</div>
		</nav>
	);
}

// Rows standing in for the first page while it loads.
function ListSkeleton() {
	return (
		<div className="rounded-xl bg-sheet p-4 shadow-card">
			<Skeleton label="Loading candidates" className="h-4 w-48" />
			<div className="mt-5 flex flex-col gap-5">
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="flex items-center gap-4">
						<Skeleton className="size-[18px]" />
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-44 max-w-full" />
							<Skeleton className="h-3 w-64 max-w-full" />
						</div>
						<Skeleton className="h-7 w-10" />
					</div>
				))}
			</div>
		</div>
	);
}

// The company has no candidates at all yet: they come from jobs.
function NoCandidatesYet() {
	return (
		<div className="rounded-xl bg-sheet shadow-card">
			<EmptyState
				swipe
				title="No candidates yet"
				actions={
					<>
						<Link to="/dashboard/jobs" className="btn">
							Go to your jobs <ArrowRight size={20} aria-hidden="true" className="arr" />
						</Link>
						<Link to="/dashboard/jobs/new" className="btn ghost">
							Post a job
						</Link>
					</>
				}
			>
				Every CV you upload to a job, and every application through a job's page, shows up here, across all your jobs.
			</EmptyState>
		</div>
	);
}

// What an empty decision filter is called, when it's the only thing narrowing the list.
const EMPTY_DECISION: Record<Exclude<AllCandidatesFilters["decision"], undefined>, { title: string; body: string }> = {
	review: { title: "Nothing to review", body: "Every scored CV has a decision. New CVs show up here once they're read." },
	shortlisted: { title: "No one is shortlisted yet", body: "Shortlist candidates here or on a job and they show up in this list." },
	rejected: { title: "No one is marked not a fit", body: "Candidates you mark not a fit show up in this list." },
	undecided: { title: "No undecided candidates", body: "Every candidate has a decision." },
};

// Nothing matches: a decision filter that is empty on its own says so plainly; anything else offers to clear.
function NoneMatch({
	filters,
	onShowAll,
	onClear,
}: {
	filters: AllCandidatesFilters;
	onShowAll: () => void;
	onClear: () => void;
}) {
	const onlyDecision = filters.decision && !isFilteredView({ ...filters, decision: undefined });
	if (onlyDecision && filters.decision) {
		const { title, body } = EMPTY_DECISION[filters.decision];
		return (
			<div className="rounded-xl bg-sheet shadow-card">
				<EmptyState
					compact
					title={title}
					actions={
						<button type="button" className="btn ghost" onClick={onShowAll}>
							Show all candidates
						</button>
					}
				>
					{body}
				</EmptyState>
			</div>
		);
	}
	return (
		<div className="rounded-xl bg-sheet shadow-card">
			<EmptyState
				compact
				title="No candidates match"
				actions={
					<button type="button" className="btn ghost" onClick={onClear}>
						Clear filters
					</button>
				}
			>
				Try another search, or clear the filters to see everyone.
			</EmptyState>
		</div>
	);
}
