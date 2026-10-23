import { ArrowDownUp, ChevronDown, Search } from "lucide-react";
import { type RefObject, useId } from "react";
import { Kbd } from "../../ui/kbd.tsx";
import { Menu, MenuItem } from "../../ui/menu.tsx";
import { type Segment, SegmentedControl } from "../../ui/segmented-control.tsx";
import { JOB_SORT_OPTIONS, type JobSort, SHOW_FILTERS, SHOW_LABEL, SORT_LABEL, type ShowFilter } from "./view.ts";

// Reading and Failed only earn a place while there is something under them (or while they are the chosen filter).
const OPTIONAL: ShowFilter[] = ["reading", "failed"];

// Above the list: the filter with its counts, the search (`/` focuses it) and the sort. All three live in the address.
export function FilterBar({
	show,
	counts,
	onShow,
	query,
	onQuery,
	searchRef,
	sort,
	onSort,
}: {
	show: ShowFilter;
	counts: Record<ShowFilter, number>;
	onShow: (show: ShowFilter) => void;
	query: string;
	onQuery: (query: string) => void;
	searchRef: RefObject<HTMLInputElement | null>;
	sort: JobSort;
	onSort: (sort: JobSort) => void;
}) {
	const showId = useId();
	const segments: Segment<ShowFilter>[] = SHOW_FILTERS.filter(
		(option) => !OPTIONAL.includes(option) || counts[option] > 0 || option === show,
	).map((option) => ({
		value: option,
		label: (
			<>
				{SHOW_LABEL[option]}{" "}
				<span className={`tabular-nums ${option === show ? "" : "text-ink-faint"}`}>{counts[option]}</span>
			</>
		),
	}));

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
			<span id={showId} className="sr-only">
				Show
			</span>
			<SegmentedControl name="show" labelledBy={showId} value={show} segments={segments} onChange={onShow} compact className="max-w-full" />
			<div className="flex min-w-0 flex-[1_1_300px] items-center gap-2">
				<label className="relative block min-w-0 flex-1">
					<span className="sr-only">Search candidates</span>
					<Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
					<input
						ref={searchRef}
						type="search"
						className="field peer pr-10 pl-10"
						value={query}
						placeholder="Name, email or summary"
						autoComplete="off"
						onChange={(event) => onQuery(event.target.value)}
					/>
					{query === "" && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 peer-focus:hidden pointer-coarse:hidden"
						>
							<Kbd>/</Kbd>
						</span>
					)}
				</label>
				<Menu
					align="end"
					trigger={(props) => (
						<button {...props} className="btn ghost flex-none px-3">
							<ArrowDownUp size={16} aria-hidden="true" />
							<span className="sr-only">Sort:</span>{" "}
							<span className="max-[480px]:sr-only">{SORT_LABEL[sort]}</span>
							<ChevronDown size={16} aria-hidden="true" />
						</button>
					)}
				>
					{JOB_SORT_OPTIONS.map(({ value, label }) => (
						<MenuItem key={value} checked={value === sort} onSelect={() => onSort(value)}>
							{label}
						</MenuItem>
					))}
				</Menu>
			</div>
		</div>
	);
}
