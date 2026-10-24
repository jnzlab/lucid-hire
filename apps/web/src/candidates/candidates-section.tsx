import type { UseQueryResult } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { FileUp, Link2, Upload } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useOrg } from "../dashboard/org.ts";
import { SectionError } from "../jobs/job-ui.tsx";
import type { Capacity } from "../jobs/workspace/capacity.ts";
import { CandidateRow } from "../jobs/workspace/candidate-row.tsx";
import { FilterBar } from "../jobs/workspace/filter-bar.tsx";
import { useArrowsLive } from "../jobs/workspace/use-arrows-live.ts";
import type { MovesState } from "../jobs/workspace/use-moves.ts";
import type { StatusChange } from "../jobs/workspace/use-status-change.ts";
import {
	type JobSearch,
	type JobSort,
	SHOW_EMPTY,
	type ShowFilter,
	candidatePath,
	isFilteredView,
	showCounts,
	viewOf,
	visibleRows,
} from "../jobs/workspace/view.ts";
import { type CandidateList, isWorking } from "../lib/candidates.ts";
import type { Job } from "../lib/jobs.ts";
import { useHotkeys } from "../lib/hotkeys.ts";
import { publicJobUrl } from "../lib/public-jobs.ts";
import { useMediaQuery } from "../lib/use-media-query.ts";
import { UpgradeAction } from "../settings/upgrade.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useToast } from "../ui/use-toast.ts";
import { BulkBar } from "./bulk-bar.tsx";
import { CandidateDetail } from "./candidate-detail.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";
import { ROW_ACTION } from "./row-action.ts";
import { useSelection } from "./use-selection.ts";

// From this width the list and the selected candidate sit side by side, each scrolling on its own.
export const SPLIT_QUERY = "(min-width: 1100px)";
// Rows drawn at first, and added by each "Show 50 more".
const PAGE_SIZE = 50;
// How long the search waits after the last key before it goes into the address.
const QUERY_DELAY_MS = 200;
const ROUTE = "/dashboard/jobs/$jobId/";

// The job page's Candidates tab: the filter bar, then the ranked list and, from 1100px, the selected candidate beside
// it. The filter, search, sort and selected candidate (`c`) live in the address. J/K (or ↓/↑) move the selection,
// Enter opens the full candidate page, Esc clears the checked rows or returns from the detail pane, `/` searches.
// Below 1100px a row opens the candidate's own page, with the view in its address so Back returns to it.
export function CandidatesSection({
	job,
	candidates,
	capacity,
	status,
	onUpload,
	moves,
}: {
	job: Job;
	candidates: UseQueryResult<CandidateList>;
	capacity: Capacity;
	status: StatusChange;
	onUpload: () => void;
	// The arrows of the last re-rank, if it was moments ago.
	moves?: MovesState;
}) {
	const list = candidates.data?.candidates;

	return (
		<section aria-labelledby="candidates-h" className="flex flex-col gap-3 min-[1100px]:min-h-0 min-[1100px]:flex-1">
			<h2 id="candidates-h" className="sr-only">
				Candidates
			</h2>
			{capacity.note && <CapacityBanner job={job} capacity={capacity} status={status} />}
			{candidates.isPending ? (
				<LoadingList />
			) : candidates.isError && !list ? (
				<SectionError
					title="We couldn't load the candidates"
					message={candidates.error.message}
					action={
						<button type="button" className="btn" onClick={() => void candidates.refetch()}>
							Try again
						</button>
					}
				/>
			) : !list || list.length === 0 ? (
				<NoCandidates job={job} canTake={capacity.note === null} onUpload={onUpload} />
			) : (
				<Workspace
					job={job}
					list={list}
					refreshFailed={candidates.isError}
					onRetry={() => void candidates.refetch()}
					moves={moves}
				/>
			)}
		</section>
	);
}

// The list and the detail pane once there is at least one CV.
function Workspace({
	job,
	list,
	refreshFailed,
	onRetry,
	moves,
}: {
	job: Job;
	list: CandidateList["candidates"];
	refreshFailed: boolean;
	onRetry: () => void;
	moves?: MovesState;
}) {
	const org = useOrg();
	const router = useRouter();
	const search = useSearch({ from: ROUTE });
	const navigate = useNavigate({ from: ROUTE });
	const split = useMediaQuery(SPLIT_QUERY, false);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const detailRef = useRef<HTMLDivElement>(null);
	const headerRef = useRef<HTMLDivElement>(null);
	const selectAllRef = useRef<HTMLElement | null>(null);
	const arrowsLive = useArrowsLive(detailRef);

	const setSearch = (patch: Partial<JobSearch>) =>
		void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true, resetScroll: false });

	// The search box answers every key at once; the address catches up after a pause. A change of address from
	// elsewhere (Back, Clear, a link) puts its words in the box.
	const [query, setQuery] = useState(search.q ?? "");
	const [seenQ, setSeenQ] = useState(search.q);
	if (search.q !== seenQ) {
		setSeenQ(search.q);
		if ((search.q ?? "") !== query.trim()) setQuery(search.q ?? "");
	}

	const { show, q, sort } = viewOf({ ...search, q: query });
	const counts = useMemo(() => showCounts(list), [list]);
	const rows = useMemo(() => visibleRows(list, { show, q, sort }), [list, show, q, sort]);
	const filtered = isFilteredView({ show, q, sort });

	// Paging starts again at 50 whenever the view changes, and always reaches far enough to show the selected row.
	const viewKey = `${show}|${q.trim()}|${sort}`;
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [limitKey, setLimitKey] = useState(viewKey);
	if (viewKey !== limitKey) {
		setLimitKey(viewKey);
		setLimit(PAGE_SIZE);
	}
	const wanted = search.c ? rows.findIndex(({ id }) => id === search.c) : -1;
	const shown = useMemo(() => rows.slice(0, Math.max(limit, wanted + 1)), [rows, limit, wanted]);
	const shownIds = useMemo(() => shown.map(({ id }) => id), [shown]);

	const selectedId = useSelectedRow({ ids: shownIds, c: search.c, split, viewKey });
	const bulk = useSelection(shownIds);

	// Where focus goes after the next render: the row J/K moved to, or the one that took over from a row that left
	// while it had focus.
	const focusNext = useRef<string | null>(null);
	const rowLink = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`) ?? null;
	useEffect(() => {
		if (!search.c || selectedId === search.c) return;
		if (selectedId && (document.activeElement === document.body || document.activeElement === null)) focusNext.current = selectedId;
		setSearch({ c: selectedId ?? undefined });
	});
	useEffect(() => {
		const id = focusNext.current;
		const row = id && rowLink(id);
		if (!row) return;
		focusNext.current = null;
		row.focus({ preventScroll: true });
		row.scrollIntoView?.({ block: "nearest" });
	});
	// The bulk bar sends focus back to the "select all" box when it goes. The box keeps its own ref (for its mixed
	// state), so it is found in the list's header.
	useEffect(() => {
		selectAllRef.current = headerRef.current?.querySelector("input") ?? null;
	});

	// A new filter or search keeps the selected candidate when it is still listed; otherwise the first row takes over.
	const keepIfShown = (next: { show?: ShowFilter; q?: string }) =>
		search.c && visibleRows(list, { show, q, sort, ...next }).some(({ id }) => id === search.c) ? search.c : undefined;
	const commitQuery = useEffectEvent(() => {
		const words = query.trim();
		setSearch({ q: words || undefined, c: keepIfShown({ q: words }) });
	});
	useEffect(() => {
		if (query.trim() === (search.q ?? "")) return;
		const timer = window.setTimeout(() => commitQuery(), QUERY_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [query, search.q]);

	const changeShow = (next: ShowFilter) => setSearch({ show: next === "all" ? undefined : next, c: keepIfShown({ show: next }) });
	const changeSort = (next: JobSort) => setSearch({ sort: next === "best" ? undefined : next });
	const clearView = () => {
		setQuery("");
		setSearch({ show: undefined, q: undefined, sort: undefined });
	};

	const hrefOf = (id: string) => candidatePath(job.id, id, { show: search.show, q, sort: search.sort });
	// Opens the candidate's own page. The row goes into this page's address first, so Back returns to it.
	const open = (id: string) => {
		if (search.c !== id) setSearch({ c: id });
		void router.navigate({ href: hrefOf(id) });
	};
	const select = (id: string, focus = false) => {
		if (focus) focusNext.current = id;
		setSearch({ c: id });
	};
	// J/K and the arrows. Moving past the last row drawn brings the next one in.
	const move = (step: 1 | -1) => {
		const index = selectedId ? rows.findIndex(({ id }) => id === selectedId) : -1;
		const next = rows[index === -1 ? 0 : Math.min(Math.max(index + step, 0), rows.length - 1)];
		if (next) select(next.id, true);
	};
	// Esc empties the checked rows first; from the detail pane it goes back to the selected row; on a narrow screen it
	// lets go of the highlighted row.
	const escape = () => {
		if (bulk.selected.size > 0) return bulk.clear();
		if (selectedId && detailRef.current?.contains(document.activeElement)) return rowLink(selectedId)?.focus();
		if (!split && search.c) setSearch({ c: undefined });
	};

	useHotkeys([
		{ keys: ["j", "ArrowDown"], label: "Next candidate", group: "Job triage", run: () => move(1), enabled: arrowsLive },
		{ keys: ["k", "ArrowUp"], label: "Previous candidate", group: "Job triage", run: () => move(-1), enabled: arrowsLive },
		// In the detail pane, a menu or a radio group the arrows keep their own job, but J and K still move.
		{ keys: "j", label: "Next candidate", group: "Job triage", run: () => move(1), enabled: !arrowsLive, hidden: true },
		{ keys: "k", label: "Previous candidate", group: "Job triage", run: () => move(-1), enabled: !arrowsLive, hidden: true },
		{
			keys: "Enter",
			label: "Open the candidate's page",
			group: "Job triage",
			run: () => selectedId && open(selectedId),
			enabled: selectedId !== null,
		},
		{ keys: "Escape", label: "Clear the selection", group: "Job triage", run: escape },
		{
			keys: "/",
			label: "Search candidates",
			group: "Lists",
			run: () => {
				searchRef.current?.focus();
				searchRef.current?.select();
			},
		},
	]);

	return (
		<>
			<FilterBar
				show={show}
				counts={counts}
				onShow={changeShow}
				query={query}
				onQuery={setQuery}
				searchRef={searchRef}
				sort={sort}
				onSort={changeSort}
			/>
			<div className="grid items-start gap-4 min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] min-[1100px]:grid-rows-[minmax(0,1fr)] min-[1100px]:items-stretch">
				<div className="flex min-w-0 flex-col rounded-xl bg-sheet shadow-card min-[1100px]:min-h-0">
					<div ref={headerRef} className="flex min-h-12 flex-none flex-wrap items-center gap-x-1 border-b border-line-2 pr-4 pl-1">
						<Checkbox
							hideLabel
							label="Select all shown"
							checked={bulk.allChecked}
							indeterminate={bulk.someChecked}
							onCheckedChange={bulk.toggleAll}
							disabled={shown.length === 0}
						/>
						<p aria-live="polite" className="min-w-0 flex-1 font-mono text-[12.5px] text-ink-muted">
							{filtered
								? `Showing ${rows.length} of ${list.length}`
								: `${list.length} ${list.length === 1 ? "candidate" : "candidates"}`}
						</p>
						{filtered && (
							<button type="button" className={ROW_ACTION} onClick={clearView}>
								Clear
							</button>
						)}
					</div>
					{refreshFailed && (
						<div className="flex-none border-b border-line-2 px-4 pt-2">
							<RefreshFailed polling={list.some(isWorking)} onRetry={onRetry} />
						</div>
					)}
					<div className="flex flex-col min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto min-[1100px]:overscroll-contain">
						{rows.length === 0 ? (
							<NoMatches show={show} onlyShow={q.trim() === ""} onClear={clearView} />
						) : (
							<ol ref={listRef} aria-label="Candidates" className="divide-y divide-line-2">
								{shown.map((candidate) => (
									<CandidateRow
										key={candidate.id}
										jobId={job.id}
										candidate={candidate}
										href={hrefOf(candidate.id)}
										selected={candidate.id === selectedId}
										checked={bulk.selected.has(candidate.id)}
										onCheck={() => bulk.toggle(candidate.id)}
										onCheckRange={() => (bulk.toggleRange ?? bulk.toggle)(candidate.id)}
										onActivate={() => (split ? select(candidate.id) : open(candidate.id))}
										onOpen={split ? () => open(candidate.id) : null}
										move={moves?.moves.get(candidate.id)}
										fresh={moves?.fresh}
									/>
								))}
							</ol>
						)}
						{rows.length > shown.length && (
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-2 px-4 py-3">
								<button type="button" className="btn ghost xs" onClick={() => setLimit(shown.length + PAGE_SIZE)}>
									Show {Math.min(PAGE_SIZE, rows.length - shown.length)} more
								</button>
								<p className="font-mono text-[12.5px] text-ink-muted">
									{shown.length} of {rows.length} shown
								</p>
							</div>
						)}
						{/* The bar sticks to the bottom of whatever scrolls the list: this pane from 1100px, the page below. */}
						<BulkBar
							selectedIds={[...bulk.selected]}
							onClear={bulk.clear}
							isAdmin={org.role === "admin"}
							exportJobId={job.id}
							returnFocus={selectAllRef}
							className="mx-2 mt-auto mb-2"
						/>
					</div>
				</div>
				{split && (
					<div ref={detailRef} className="min-w-0 overflow-hidden rounded-xl border border-line-2 bg-paper min-[1100px]:min-h-0">
						{selectedId ? (
							<CandidateDetail key={selectedId} jobId={job.id} candidateId={selectedId} mode="panel" />
						) : (
							<EmptyState compact title="No candidate selected">
								Pick someone from the list to see their evidence here.
							</EmptyState>
						)}
					</div>
				)}
			</div>
		</>
	);
}

// Which row is selected. In the split view there always is one: the one in the address, else the first. When the
// selected candidate leaves the list while the view stays the same (decided under "To review", deleted), the row now
// in its place takes over, or the last row if it was at the end. On a narrow screen only a row named in the address
// is highlighted (the one the recruiter came back from).
function useSelectedRow({ ids, c, split, viewKey }: { ids: string[]; c: string | undefined; split: boolean; viewKey: string }) {
	// Where the named row last sat, in which view. Kept in state while rendering (React's "adjust state when a prop
	// changes"), so the row that takes over is known in the same render the old one disappears.
	const [place, setPlace] = useState<{ id: string; index: number; viewKey: string } | null>(null);
	const index = c ? ids.indexOf(c) : -1;
	if (c && index !== -1 && (place?.id !== c || place.index !== index || place.viewKey !== viewKey)) {
		setPlace({ id: c, index, viewKey });
	}
	if (c && index !== -1) return c;
	if (c && place?.id === c && place.viewKey === viewKey && ids.length > 0) return ids[Math.min(place.index, ids.length - 1)];
	return split ? (ids[0] ?? null) : null;
}

// What the list says when the filter or search leaves nothing. A filter on its own explains itself; anything more
// offers to clear it all.
function NoMatches({ show, onlyShow, onClear }: { show: ShowFilter; onlyShow: boolean; onClear: () => void }) {
	if (onlyShow && show !== "all") {
		return <p className="px-5 py-6 text-[15px] text-ink-2">{SHOW_EMPTY[show]}</p>;
	}
	return (
		<div className="flex flex-col items-start gap-1 px-5 py-6">
			<p className="text-[15px] text-ink-2">No candidates match your search and filters.</p>
			<button type="button" className={ROW_ACTION} onClick={onClear}>
				Clear search and filters
			</button>
		</div>
	);
}

// Why the job can't take CVs, above the list, with the one thing that changes it.
function CapacityBanner({ job, capacity, status }: { job: Job; capacity: Capacity; status: StatusChange }) {
	const org = useOrg();
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-[1.5px] border-line bg-sheet px-4 py-2">
			<p className="min-w-0 flex-[1_1_280px] py-1.5 text-[15px] text-ink-2">{capacity.note}</p>
			{job.status !== "open" ? (
				<StatusButton status={status} />
			) : (
				capacity.upgradable && <UpgradeAction isAdmin={org.role === "admin"} />
			)}
		</div>
	);
}

// "Open job" or "Reopen job" outside the status menu: in the banner and the upload drawer. Only looks disabled while it
// saves, so it keeps keyboard focus.
export function StatusButton({ status }: { status: StatusChange }) {
	return (
		<button type="button" className="btn xs" aria-disabled={status.pending} onClick={status.change}>
			{status.pending ? "Saving" : status.next.label}
		</button>
	);
}

// A job without a single CV yet: drop them anywhere on the page, upload them, or hand out the apply link.
function NoCandidates({ job, canTake, onUpload }: { job: Job; canTake: boolean; onUpload: () => void }) {
	const toast = useToast();
	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(publicJobUrl(job.slug));
			toast.show("Apply link copied");
		} catch {
			toast.error("Couldn't copy. Open Share and copy the link from there.");
		}
	};
	return (
		<div className="rounded-xl border-2 border-dashed border-line bg-sheet min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto">
			<EmptyState
				swipe
				title="No CVs yet"
				illustration={<FileUp size={44} strokeWidth={1.6} className="text-ink" />}
				actions={
					canTake && (
						<>
							<button type="button" className="btn" onClick={onUpload}>
								<Upload size={18} aria-hidden="true" />
								Upload CVs
							</button>
							{job.status === "open" && (
								<button type="button" className="btn ghost" onClick={() => void copyLink()}>
									<Link2 size={18} aria-hidden="true" />
									Copy apply link
								</button>
							)}
						</>
					)
				}
			>
				{canTake
					? "Drop PDFs anywhere on this page, or share the apply link. Every CV is read and ranked against this job."
					: "Uploaded CVs and applications are read and ranked here, best match first."}
			</EmptyState>
		</div>
	);
}

// Rows of grey bars while the list loads.
function LoadingList() {
	return (
		<div className="rounded-xl bg-sheet p-5 shadow-card">
			<Skeleton label="Loading candidates" className="h-4 w-40" />
			<div className="mt-5 flex flex-col gap-5">
				{[0, 1, 2, 3].map((row) => (
					<div key={row} className="flex items-center gap-4">
						<Skeleton className="h-4 w-4" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-1/2" />
							<Skeleton className="h-3 w-3/4" />
						</div>
						<Skeleton className="h-7 w-8" />
					</div>
				))}
			</div>
		</div>
	);
}
