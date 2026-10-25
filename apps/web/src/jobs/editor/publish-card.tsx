import { type ReactNode, useId } from "react";
import { ArrowRight } from "../../components/icons.tsx";
import type { JobStatus } from "../../lib/jobs.ts";
import { HOVER_QUERY, useMediaQuery } from "../../lib/use-media-query.ts";
import { AppLink } from "../../ui/app-link.tsx";
import { Shortcut } from "../../ui/kbd.tsx";
import type { StatusChoice } from "./publish.ts";

// The status as two radio cards (design system §4, plan card: the chosen one has an ink border). Real radios with
// one name, so the arrow keys and the single tab stop come from the browser; the card's own words say what each
// status means for candidates.
function StatusChoices({
	choices,
	value,
	onChange,
}: {
	choices: StatusChoice[];
	value: JobStatus;
	onChange: (status: JobStatus) => void;
}) {
	const base = useId();
	return (
		<fieldset>
			<legend className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">Status</legend>
			<div className="mt-2.5 flex flex-col gap-2">
				{choices.map((choice) => {
					const chosen = choice.value === value;
					const labelId = `${base}-${choice.value}`;
					return (
						<label key={choice.value} className="relative block cursor-pointer">
							<input
								type="radio"
								name="status"
								value={choice.value}
								checked={chosen}
								onChange={() => onChange(choice.value)}
								aria-labelledby={labelId}
								aria-describedby={`${labelId}-d`}
								className="peer sr-only"
							/>
							<span
								className={`flex items-start gap-3 rounded-lg border-[1.5px] bg-sheet px-3.5 py-2.5 transition-colors duration-200 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${chosen ? "border-ink" : "border-line hover:border-ink-faint"}`}
							>
								<span
									aria-hidden="true"
									className={`mt-0.5 grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] ${chosen ? "border-on-marker bg-marker" : "border-ink-faint bg-sheet"}`}
								>
									{chosen && <span className="size-2 rounded-full bg-on-marker" />}
								</span>
								<span className="min-w-0">
									<span id={labelId} className={`block text-[15px] leading-[1.3] text-ink ${chosen ? "font-[650]" : "font-semibold"}`}>
										{choice.label}
									</span>
									<span id={`${labelId}-d`} className="mt-0.5 block text-[13.5px] leading-[1.4] text-ink-muted">
										{choice.description}
									</span>
								</span>
							</span>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

// The save button and the way out. In the Publish card they stack (the button full width, Cancel and the shortcut
// under it); in the bar at the bottom of a narrow screen they sit side by side. `notices` (the job limit, a save
// error) go just above the button, where the recruiter is looking when it doesn't work.
export function PublishActions({
	label,
	arrow,
	saving,
	blocked,
	cancelHref,
	notices,
	layout,
}: {
	label: string;
	// The trailing arrow, for "Open job".
	arrow: boolean;
	saving: boolean;
	// The save can't happen (the month's jobs are used up): the button is really disabled.
	blocked: boolean;
	cancelHref: string;
	notices?: ReactNode;
	layout: "card" | "bar";
}) {
	const hover = useMediaQuery(HOVER_QUERY, false);
	// The save buttons only look disabled while saving (aria-disabled), so focus stays on them; the form ignores
	// the extra clicks.
	const save = (
		<button type="submit" className={`btn ${layout === "card" ? "w-full" : "min-w-0 flex-1"}`} aria-disabled={saving} disabled={blocked}>
			{label}
			{arrow && !saving && <ArrowRight />}
		</button>
	);
	if (layout === "bar") {
		return (
			<div className="flex flex-col gap-3">
				{notices}
				<div className="flex items-center gap-3">
					<AppLink href={cancelHref} className="btn ghost flex-none">
						Cancel
					</AppLink>
					{save}
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{notices}
			{save}
			<div className="flex min-h-11 items-center justify-between gap-3">
				<AppLink
					href={cancelHref}
					className="inline-flex min-h-11 items-center rounded-[3px] px-1 text-[15px] font-semibold text-ink-2 underline underline-offset-[.18em] hover:text-ink"
				>
					Cancel
				</AppLink>
				{hover && (
					<span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-muted">
						or press <Shortcut keys="mod+enter" />
					</span>
				)}
			</div>
		</div>
	);
}

// The side column's first card: what happens when the job is saved. The status choice drives the button's label;
// on a new job the month's allowance shows under it. `children` are the actions, when they live here (wide screens).
export function PublishCard({
	choices,
	status,
	onStatus,
	allowance,
	preview,
	children,
}: {
	choices: StatusChoice[];
	status: JobStatus;
	onStatus: (status: JobStatus) => void;
	allowance?: ReactNode;
	// A link to the live apply page, beside the heading (a saved job candidates can see).
	preview?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section aria-labelledby="publish-h" className="rounded-xl bg-sheet p-5 shadow-card min-[561px]:p-6">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h2 id="publish-h" className="text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Publish
				</h2>
				{preview}
			</div>
			<div className="mt-4">
				<StatusChoices choices={choices} value={status} onChange={onStatus} />
			</div>
			{allowance && <div className="mt-5 border-t border-line-2 pt-4">{allowance}</div>}
			{children && <div className="mt-5">{children}</div>}
		</section>
	);
}
