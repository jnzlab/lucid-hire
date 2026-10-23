import { useRouter } from "@tanstack/react-router";
import {
	BriefcaseBusiness,
	ChevronRight,
	CreditCard,
	FileText,
	Keyboard,
	LogOut,
	Monitor,
	Moon,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search,
	Sun,
	Upload,
	UsersRound,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { STATUS_LABEL } from "../lib/jobs.ts";
import { type RecentVisit, useRecentVisits } from "../lib/recent.ts";
import { useSearch } from "../lib/search.ts";
import { type ThemePreference, setThemePreference } from "../lib/theme.ts";
import { DESKTOP_QUERY, HOVER_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { DecisionTag } from "../ui/decision-tag.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { Kbd, Shortcut } from "../ui/kbd.tsx";
import { NAV_ITEMS, NEW_JOB_PATH, SETTINGS_ITEM, SETTINGS_PAGES } from "./nav.ts";
import { useOpenJobs } from "./shell-data.ts";

export type PaletteStep = "root" | "upload";

type Item = {
	id: string;
	label: string;
	icon: ReactNode;
	// Mono text on the right: "Job", "Backend Engineer".
	meta?: ReactNode;
	// Anything else on the right (a score and a decision tag).
	extra?: ReactNode;
	shortcut?: string;
	// More words that find it: "theme" for Dark.
	keywords?: string;
	// Opens a second step instead of closing.
	next?: PaletteStep;
	run?: () => void;
};
type Group = { label: string; items: Item[] };

const icon = (Icon: typeof Search) => <Icon size={20} strokeWidth={2} aria-hidden="true" />;
const matches = (item: Item, query: string) =>
	`${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(query.toLowerCase());

// The label with the typed text marked (one mark per row, spec §2.3).
function Highlight({ text, query }: { text: string; query: string }) {
	const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
	if (at < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, at)}
			<span className="mk [margin-inline:0]">{text.slice(at, at + query.length)}</span>
			{text.slice(at + query.length)}
		</>
	);
}

// The command palette (spec §2.3), opened with Ctrl/⌘+K, the sidebar's search field or the tab bar's Search. One
// field searches jobs and candidates and filters the commands; arrow keys, Home and End move through the results
// (the combobox and listbox pattern), Enter runs one, Escape closes and focus goes back to the opener.
export function CommandPalette({
	initialStep = "root",
	collapsed,
	onClose,
	onToggleSidebar,
	onShortcuts,
}: {
	initialStep?: PaletteStep;
	collapsed: boolean;
	onClose: () => void;
	onToggleSidebar: () => void;
	onShortcuts: () => void;
}) {
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();
	const [step, setStep] = useState<PaletteStep>(initialStep);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const desktop = useMediaQuery(DESKTOP_QUERY, true);
	const hover = useMediaQuery(HOVER_QUERY, true);
	const recent = useRecentVisits();
	const search = useSearch(step === "root" ? query : "");
	const openJobs = useOpenJobs();
	const typed = query.trim();

	const groups = useMemo<Group[]>(() => {
		const go = (href: string) => () => void router.navigate({ href });
		if (step === "upload") {
			const jobs = (openJobs.data?.jobs ?? [])
				.filter((job) => job.title.toLowerCase().includes(typed.toLowerCase()))
				.map<Item>((job) => ({
					id: `upload-${job.id}`,
					label: job.title,
					icon: icon(Upload),
					meta: `${job.cvCount} ${job.cvCount === 1 ? "CV" : "CVs"}`,
					run: go(`/dashboard/jobs/${job.id}#upload`),
				}));
			return [{ label: "Open jobs", items: jobs }];
		}

		const goTo: Item[] = [
			...NAV_ITEMS.map((item) => ({ id: `go-${item.href}`, label: item.label, icon: icon(item.icon), shortcut: item.hotkey, run: go(item.href) })),
			{ id: "go-settings", label: SETTINGS_ITEM.label, icon: icon(SETTINGS_ITEM.icon), shortcut: SETTINGS_ITEM.hotkey, keywords: "company", run: go(SETTINGS_ITEM.href) },
			{ id: "go-billing", label: "Plan & billing", icon: icon(CreditCard), keywords: "upgrade plans pricing invoice", run: go(SETTINGS_PAGES.billing) },
			{ id: "go-team", label: "Team", icon: icon(UsersRound), keywords: "members invite people", run: go(SETTINGS_PAGES.team) },
		];
		const theme = (value: ThemePreference, label: string, Icon: typeof Sun): Item => ({
			id: `theme-${value}`,
			label: `Theme: ${label}`,
			icon: icon(Icon),
			keywords: "appearance dark light mode colour color",
			run: () => setThemePreference(value),
		});
		const actions: Item[] = [
			{ id: "post", label: "Post a job", icon: icon(Plus), shortcut: "n", keywords: "new create job", run: go(NEW_JOB_PATH) },
			{ id: "upload", label: "Upload CVs to…", icon: icon(Upload), keywords: "add cv resume", next: "upload" },
			theme("system", "System", Monitor),
			theme("light", "Light", Sun),
			theme("dark", "Dark", Moon),
			{ id: "shortcuts", label: "Keyboard shortcuts", icon: icon(Keyboard), shortcut: "?", keywords: "help keys", run: onShortcuts },
			...(desktop
				? [
						{
							id: "sidebar",
							label: collapsed ? "Expand sidebar" : "Collapse sidebar",
							icon: icon(collapsed ? PanelLeftOpen : PanelLeftClose),
							shortcut: "mod+b",
							keywords: "rail navigation",
							run: onToggleSidebar,
						},
					]
				: []),
			{ id: "sign-out", label: "Sign out", icon: icon(LogOut), keywords: "log out leave", run: go("/sign-out") },
		];

		if (!typed) {
			const recentItems = recent.map<Item>((visit: RecentVisit) =>
				visit.kind === "job"
					? { id: `recent-job-${visit.id}`, label: visit.title, icon: icon(BriefcaseBusiness), meta: "Job", run: go(`/dashboard/jobs/${visit.id}`) }
					: {
							id: `recent-candidate-${visit.id}`,
							label: visit.name,
							icon: icon(FileText),
							meta: visit.jobTitle ?? "Candidate",
							run: go(`/dashboard/jobs/${visit.jobId}/candidates/${visit.id}`),
						},
			);
			return [
				...(recentItems.length ? [{ label: "Recent", items: recentItems }] : []),
				{ label: "Go to", items: goTo },
				{ label: "Actions", items: actions },
			];
		}

		const results = search.results;
		const jobs = (results?.jobs ?? []).map<Item>((job) => ({
			id: `job-${job.id}`,
			label: job.title,
			icon: icon(BriefcaseBusiness),
			meta: `${STATUS_LABEL[job.status]} · ${job.cvCount} ${job.cvCount === 1 ? "CV" : "CVs"}`,
			run: go(`/dashboard/jobs/${job.id}`),
		}));
		const candidates = (results?.candidates ?? []).map<Item>((candidate) => ({
			id: `candidate-${candidate.id}`,
			label: candidate.name ?? candidate.fileName,
			icon: icon(FileText),
			meta: candidate.jobTitle,
			extra: (
				<>
					{candidate.score !== null && (
						<span className="font-display text-[22px] leading-none font-[800] tabular-nums [font-stretch:62%]">
							<span className="sr-only">Score </span>
							{candidate.score}
						</span>
					)}
					<DecisionTag decision={candidate.decision} />
				</>
			),
			run: go(`/dashboard/jobs/${candidate.jobId}/candidates/${candidate.id}`),
		}));
		const commands = [...goTo, ...actions].filter((item) => matches(item, typed));
		// While the results for the latest keystroke are on their way, the previous ones stay up only where they
		// still match what's typed, so Enter never opens a match for older text.
		const current = (items: Item[]) => (search.isSearching ? items.filter((item) => matches(item, typed)) : items);
		const shownJobs = current(jobs);
		const shownCandidates = current(candidates);
		return [
			...(shownJobs.length ? [{ label: "Jobs", items: shownJobs }] : []),
			...(shownCandidates.length ? [{ label: "Candidates", items: shownCandidates }] : []),
			...(commands.length ? [{ label: "Commands", items: commands }] : []),
		];
	}, [router, step, typed, recent, search.results, search.isSearching, openJobs.data, desktop, collapsed, onShortcuts, onToggleSidebar]);

	const flat = groups.flatMap((group) => group.items);
	const index = flat.length ? Math.min(active, flat.length - 1) : -1;
	const activeItem = index >= 0 ? flat[index] : undefined;
	const optionId = (item: Item) => `${listId}-${item.id}`;
	// A label like "Go to" has a space, and aria-labelledby reads spaces as separate ids.
	const groupId = (group: Group) => `${listId}-group-${group.label.replace(/\W+/g, "-")}`;
	const activeId = activeItem ? optionId(activeItem) : undefined;

	useEffect(() => {
		if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
	}, [activeId]);

	const runItem = (item: Item) => {
		if (item.next) {
			setStep(item.next);
			setQuery("");
			setActive(0);
			inputRef.current?.focus();
			return;
		}
		onClose();
		item.run?.();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const last = flat.length - 1;
		const moves: Record<string, number> = {
			ArrowDown: index >= last ? 0 : index + 1,
			ArrowUp: index <= 0 ? last : index - 1,
			Home: 0,
			End: last,
		};
		if (event.key in moves && flat.length) {
			event.preventDefault();
			setActive(moves[event.key]);
		} else if (event.key === "Enter" && activeItem) {
			event.preventDefault();
			runItem(activeItem);
		} else if (event.key === "Backspace" && query === "" && step !== "root") {
			event.preventDefault();
			setStep("root");
			setActive(0);
		}
	};

	const searching = step === "root" && typed !== "" && search.isSearching;
	const empty = flat.length === 0 && !searching && (step === "upload" ? !openJobs.isPending : !search.isSearching);

	return (
		<Dialog
			placement="top"
			size="lg"
			label="Search and commands"
			closeButton={false}
			padded={false}
			initialFocus={inputRef}
			onClose={onClose}
			className="flex max-h-[min(640px,80dvh)] flex-col overflow-hidden"
		>
			<div className="flex min-h-14 flex-none items-center gap-3 border-b border-line-2 px-4">
				<Search size={20} aria-hidden="true" className="flex-none text-ink-muted" />
				{step === "upload" && (
					<span className="flex-none rounded-md border border-line bg-paper-2 px-2 py-1 font-mono text-[12px] text-ink-2">Upload CVs to</span>
				)}
				<input
					ref={inputRef}
					role="combobox"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={activeId}
					aria-autocomplete="list"
					aria-label={step === "upload" ? "Choose a job to upload CVs to" : "Search jobs and candidates, or type a command"}
					placeholder={step === "upload" ? "Choose a job" : "Search jobs and candidates, or type a command"}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
					autoComplete="off"
					spellCheck={false}
					className="min-h-14 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
				/>
				{hover && <Kbd className="flex-none">Esc</Kbd>}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				<div role="status" className="empty:sr-only">
					{searching && (
						<p className="flex items-center gap-2.5 px-3 py-2 font-mono text-[13px] text-ink-muted">
							<span className="live-dot" aria-hidden="true" />
							Searching
						</p>
					)}
					{empty && (
						<p className="px-3 py-6 text-center text-[15px] text-ink-2">
							{step === "upload" ? (
								typed ? (
									<>No open jobs match “{typed}”.</>
								) : (
									<>You have no open jobs to upload CVs to.</>
								)
							) : (
								<>No jobs, candidates or commands match “{typed}”.</>
							)}
						</p>
					)}
					{search.error && step === "root" && typed !== "" && !searching && (
						<p className="px-3 py-2 font-mono text-[13px] text-gap-ink">
							✕ Search isn't working right now.{" "}
							<button type="button" onClick={search.retry} className="underline underline-offset-[.18em]">
								Try again
							</button>
						</p>
					)}
				</div>
				<div id={listId} role="listbox" aria-label="Results">
					{groups.map((group) =>
						group.items.length === 0 ? null : (
							<div key={group.label} role="group" aria-labelledby={groupId(group)} className="pb-2">
								<div id={groupId(group)} className="px-3 pt-2 pb-1 font-mono text-[11.5px] tracking-[.08em] text-ink-muted uppercase">
									{group.label}
								</div>
								{group.items.map((item) => {
									const selected = item === activeItem;
									return (
										<div
											key={item.id}
											id={optionId(item)}
											role="option"
											aria-selected={selected}
											onMouseMove={() => {
												if (!selected) setActive(flat.indexOf(item));
											}}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => runItem(item)}
											className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[15px] text-ink ${selected ? "bg-paper-2" : ""}`}
										>
											<span className={`flex-none ${selected ? "text-ink" : "text-ink-muted"}`}>{item.icon}</span>
											<span className="min-w-0 flex-1 truncate">
												<Highlight text={item.label} query={typed} />
											</span>
											{item.extra && <span className="flex flex-none items-center gap-2">{item.extra}</span>}
											{item.meta && <span className="max-w-[40%] flex-none truncate font-mono text-[12.5px] text-ink-muted">{item.meta}</span>}
											{item.shortcut && hover && <Shortcut keys={item.shortcut} className="flex-none" />}
											{item.next && <ChevronRight size={16} aria-hidden="true" className="flex-none text-ink-muted" />}
										</div>
									);
								})}
							</div>
						),
					)}
				</div>
			</div>

			{hover && (
				<p className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-2 px-4 py-2.5 font-mono text-[12px] text-ink-muted">
					<span className="inline-flex items-center gap-1.5">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd> to move
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Kbd>Enter</Kbd> to open
					</span>
					{step === "upload" && (
						<span className="inline-flex items-center gap-1.5">
							<Kbd>⌫</Kbd> to go back
						</span>
					)}
				</p>
			)}
		</Dialog>
	);
}
