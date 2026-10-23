import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { formatNumber } from "../lib/format.ts";
import { JOB_SEARCH_MAX, STATUS_LABEL, useJob, useJobs } from "../lib/jobs.ts";
import { Popover } from "../ui/popover.tsx";
import { filterButton } from "./filter-button.ts";

const FILTER_DEBOUNCE_MS = 200;

// The Job filter: a button showing the chosen job ("All jobs" by default) that opens a panel with a field to find a
// job by title. The panel lists the 20 most recently active jobs that match (the jobs list's page), searched on the
// server, so a company with many jobs can still reach any of them.
export function JobPicker({
	jobId,
	knownTitle,
	onChange,
}: {
	jobId: string | undefined;
	// The chosen job's title when the page already has it (from its rows or the jobs list).
	knownTitle: string | undefined;
	onChange: (jobId: string | undefined) => void;
}) {
	return (
		<Popover
			label="Filter by job"
			align="start"
			className="w-[min(380px,calc(100vw-16px))] p-0"
			trigger={(props) => (
				<button {...props} className={filterButton(Boolean(jobId))}>
					<span className="max-w-[min(240px,55vw)] truncate">
						<span className="sr-only">Job:</span>{" "}
						{!jobId ? "All jobs" : knownTitle ? knownTitle : <FetchedTitle jobId={jobId} />}
					</span>
					<ChevronDown size={16} aria-hidden="true" className="flex-none text-ink-muted" />
				</button>
			)}
		>
			{(close) => (
				<JobOptions
					jobId={jobId}
					onChoose={(id) => {
						close();
						if (id !== jobId) onChange(id);
					}}
				/>
			)}
		</Popover>
	);
}

// A job that isn't among the ones already loaded (an old link, say) is looked up on its own.
function FetchedTitle({ jobId }: { jobId: string }) {
	const job = useJob(jobId);
	if (job.data) return job.data.title;
	return job.isError ? "Unknown job" : "Loading";
}

type Option = { id: string | undefined; title: string; meta?: string };

// The field and the list inside the panel, as a combobox: typing filters, the arrow keys, Home and End move through
// the options, Enter chooses one and the pointer moves the active option too.
function JobOptions({ jobId, onChoose }: { jobId: string | undefined; onChoose: (jobId: string | undefined) => void }) {
	const listId = useId();
	const optionId = (index: number) => `${listId}-${index}`;
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), FILTER_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text]);

	const jobs = useJobs({ q: query || undefined, sort: "activity" });
	const options: Option[] = [
		...(query ? [] : [{ id: undefined, title: "All jobs" }]),
		...(jobs.data?.jobs ?? []).map((job) => ({
			id: job.id,
			title: job.title,
			meta: `${STATUS_LABEL[job.status]} · ${formatNumber(job.cvCount)} ${job.cvCount === 1 ? "CV" : "CVs"}`,
		})),
	];
	const current = Math.min(active, Math.max(0, options.length - 1));
	const more = jobs.data ? jobs.data.total - jobs.data.jobs.length : 0;

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const last = options.length - 1;
		const move = (index: number) => {
			event.preventDefault();
			setActive(index);
			document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
		};
		if (event.key === "ArrowDown") move(current >= last ? 0 : current + 1);
		else if (event.key === "ArrowUp") move(current <= 0 ? last : current - 1);
		else if (event.key === "Home" && options.length > 0) move(0);
		else if (event.key === "End" && options.length > 0) move(last);
		else if (event.key === "Enter") {
			event.preventDefault();
			const option = options[current];
			if (option) onChoose(option.id);
		}
	};

	return (
		<div className="flex max-h-[min(420px,70dvh)] flex-col">
			<div className="flex-none border-b border-line-2 p-2">
				<input
					data-autofocus
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
					aria-autocomplete="list"
					aria-label="Find a job"
					placeholder="Find a job"
					maxLength={JOB_SEARCH_MAX}
					autoComplete="off"
					className="field"
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-1.5">
				<div role="status" className="empty:sr-only">
					{jobs.isPending ? (
						<p className="flex items-center gap-2.5 px-2.5 py-2 font-mono text-[13px] text-ink-muted">
							<span className="live-dot" aria-hidden="true" />
							Loading jobs
						</p>
					) : jobs.isError && !jobs.data ? (
						<p className="px-2.5 py-2 font-mono text-[13px] text-gap-ink">
							✕ Couldn't load the jobs.{" "}
							<button type="button" className="underline underline-offset-[.18em]" onClick={() => void jobs.refetch()}>
								Try again
							</button>
						</p>
					) : options.length === 0 ? (
						<p className="px-2.5 py-4 text-center text-[15px] text-ink-2">No jobs match “{query}”.</p>
					) : null}
				</div>
				<div id={listId} role="listbox" aria-label="Jobs">
					{options.map((option, index) => {
						const chosen = option.id === jobId;
						return (
							<div
								key={option.id ?? "all"}
								id={optionId(index)}
								role="option"
								aria-selected={index === current}
								onPointerMove={() => setActive(index)}
								onClick={() => onChoose(option.id)}
								className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] text-ink ${index === current ? "bg-paper-2" : ""}`}
							>
								<span className="grid size-4 flex-none place-items-center">
									{chosen && <Check size={16} aria-hidden="true" />}
								</span>
								<span className={`min-w-0 flex-1 truncate ${chosen ? "font-[650]" : ""}`}>
									{option.title}
									{chosen && " "}
									{chosen && <span className="sr-only">(shown now)</span>}
								</span>
								{option.meta && <span className="flex-none font-mono text-[12px] text-ink-muted">{option.meta}</span>}
							</div>
						);
					})}
				</div>
				{more > 0 && (
					<p className="px-2.5 pt-2 pb-1 font-mono text-[12px] text-ink-muted">
						{formatNumber(more)} more {more === 1 ? "job" : "jobs"}. Type to find {more === 1 ? "it" : "them"}.
					</p>
				)}
			</div>
		</div>
	);
}
