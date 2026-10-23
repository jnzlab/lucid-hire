import { useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useHotkeys } from "../../lib/hotkeys.ts";
import {
	JOB_SEARCH_MAX,
	JOB_SORT_MENU,
	type JobCounts,
	type JobFilters,
	type JobSort,
	type JobStatus,
	SORT_LABEL,
} from "../../lib/jobs.ts";
import { HOVER_QUERY, useMediaQuery } from "../../lib/use-media-query.ts";
import { AppLink } from "../../ui/app-link.tsx";
import { CountBadge } from "../../ui/count-badge.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Menu, MenuItem } from "../../ui/menu.tsx";
import { useJobsHref } from "./use-jobs-href.ts";

const SEARCH_DEBOUNCE_MS = 300;
const STATUS_TABS: { status?: JobStatus; label: string; count: keyof JobCounts }[] = [
	{ label: "All", count: "all" },
	{ status: "open", label: "Open", count: "open" },
	{ status: "draft", label: "Drafts", count: "draft" },
	{ status: "closed", label: "Closed", count: "closed" },
];
const CONTROL =
	"inline-flex min-h-10 items-center gap-2 rounded-md text-[14px] font-[550] whitespace-nowrap text-ink transition-colors pointer-coarse:min-h-11";

// Status tabs with counts, the search box, the sort menu and Clear filters. Everything lives in the address
// (`?q=&status=&sort=&page=`), so a filtered list can be bookmarked, shared and reached with the back button. Typing
// waits a moment before it searches; `/` jumps to the box from anywhere on the page.
export function JobsToolbar({ filters, counts }: { filters: JobFilters; counts: JobCounts }) {
	const navigate = useNavigate({ from: "/dashboard/jobs/" });
	const href = useJobsHref();
	const searchId = useId();
	const hover = useMediaQuery(HOVER_QUERY);
	const inputRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState(filters.q ?? "");
	const sent = useRef(filters.q ?? "");
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const clean = (value: string) => value.trim().replace(/\s+/g, " ");

	// The address changed from outside (back button, Clear filters): the box follows it.
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
			label: "Search jobs",
			group: "Lists",
			run: () => {
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
		void navigate({ search: (prev) => ({ ...prev, q: q || undefined, page: undefined }), replace: true });
	};
	const clearSearch = () => {
		setText("");
		search("");
		inputRef.current?.focus();
	};
	const sortBy = (sort: JobSort) =>
		void navigate({ search: (prev) => ({ ...prev, sort: sort === "newest" ? undefined : sort, page: undefined }) });
	const clearAll = () => {
		clearTimeout(timer.current);
		sent.current = "";
		setText("");
		void navigate({ search: {} });
	};

	const sort: JobSort = filters.sort ?? "newest";
	// An old link can ask for a sort the menu no longer offers ("Most candidates"); it's listed while it's chosen.
	const sorts = JOB_SORT_MENU.includes(sort) ? JOB_SORT_MENU : [...JOB_SORT_MENU, sort];
	const customised = Boolean(filters.q || filters.status || filters.sort);

	return (
		<div className="@container">
			<div className="flex flex-col @min-[880px]:flex-row @min-[880px]:items-end">
				<nav aria-label="Job status" className="tablist min-w-0 gap-0 @min-[420px]:gap-1 @min-[880px]:flex-1">
					{STATUS_TABS.map((tab) => {
						const current = filters.status === tab.status;
						return (
							<AppLink
								key={tab.label}
								href={href({ ...filters, status: tab.status, page: undefined })}
								aria-current={current ? "page" : undefined}
								className="tab gap-1.5 px-1.5 @min-[420px]:gap-2 @min-[420px]:px-3"
							>
								{tab.label}
								<CountBadge count={counts[tab.count]} showZero className={current ? "border-ink-faint text-ink" : ""} />
							</AppLink>
						);
					})}
				</nav>
				<div
					role="search"
					aria-label="Search and sort jobs"
					className="mt-4 flex flex-wrap items-center gap-2 @min-[880px]:mt-0 @min-[880px]:flex-nowrap @min-[880px]:border-b @min-[880px]:border-line @min-[880px]:pb-1 @min-[880px]:pl-4"
				>
					<form
						className="relative min-w-[180px] flex-[1_1_180px] @min-[880px]:w-[280px] @min-[880px]:flex-none"
						onSubmit={(event) => {
							event.preventDefault();
							search(text);
						}}
					>
						<label htmlFor={searchId} className="sr-only">
							Search jobs
						</label>
						<input
							ref={inputRef}
							id={searchId}
							type="search"
							className={`peer field min-h-10 py-2 pl-9 placeholder:text-ink-muted pointer-coarse:min-h-11 [&::-webkit-search-cancel-button]:appearance-none ${text || hover ? "pr-11" : "pr-3"}`}
							placeholder="Title or description"
							maxLength={JOB_SEARCH_MAX}
							autoComplete="off"
							enterKeyHint="search"
							value={text}
							onChange={(event) => {
								setText(event.target.value);
								clearTimeout(timer.current);
								timer.current = setTimeout(() => search(event.target.value), SEARCH_DEBOUNCE_MS);
							}}
							onKeyDown={(event) => {
								// Escape empties the box, and leaves it when it's already empty.
								if (event.key !== "Escape") return;
								event.preventDefault();
								if (text) clearSearch();
								else event.currentTarget.blur();
							}}
						/>
						<Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
						{text ? (
							<button
								type="button"
								onClick={clearSearch}
								className="absolute top-0 right-0 grid h-full w-10 place-items-center rounded-r-md text-ink-muted hover:text-ink pointer-coarse:w-11"
							>
								<X size={16} aria-hidden="true" />
								<span className="sr-only">Clear search</span>
							</button>
						) : (
							hover && <Kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 peer-focus:hidden">/</Kbd>
						)}
					</form>
					<Menu
						align="end"
						trigger={(props) => (
							<button
								{...props}
								className={`${CONTROL} border-[1.5px] border-line bg-sheet px-3 hover:border-ink-faint aria-expanded:border-ink`}
							>
								<ArrowUpDown size={16} aria-hidden="true" className="text-ink-muted" />
								<span>
									<span className="sr-only">Sort by</span> {SORT_LABEL[sort]}
								</span>
								<ChevronDown size={16} aria-hidden="true" className="text-ink-muted" />
							</button>
						)}
					>
						{sorts.map((option) => (
							<MenuItem key={option} checked={option === sort} onSelect={() => sortBy(option)}>
								{SORT_LABEL[option]}
							</MenuItem>
						))}
					</Menu>
					{customised && (
						<button type="button" onClick={clearAll} className={`${CONTROL} px-2.5 text-ink-2 hover:bg-line-2 hover:text-ink`}>
							<X size={16} aria-hidden="true" />
							Clear filters
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
