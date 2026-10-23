import { NotebookPen } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type Candidate, type Decision, NOTE_MAX, useDecideCandidate } from "../lib/candidates.ts";
import { formatDate, formatNumber } from "../lib/format.ts";
import { useSession } from "../lib/session.ts";
import { displayName, useTeam } from "../lib/team.ts";
import { Kbd } from "../ui/kbd.tsx";
import { NOTE_SAVE_DELAY_MS } from "./detail/requirements.ts";

const OPTIONS: { value: Decision; label: string; key: string; mark?: "yes" | "no" }[] = [
	{ value: "shortlisted", label: "Shortlist", key: "s", mark: "yes" },
	{ value: "rejected", label: "Not a fit", key: "x", mark: "no" },
	{ value: "undecided", label: "Undecided", key: "u" },
];

// The chosen segment: on the yellow marker for a shortlist, on the pink one for "not a fit", plain for undecided.
// The marker ones keep their light inks in dark mode (on-marker-area), so the keycap on them stays readable.
const CHOSEN = {
	plain: "border-ink bg-sheet text-ink shadow-card",
	yes: "on-marker-area border-on-marker bg-marker text-on-marker",
	no: "on-marker-area border-on-marker bg-gap text-on-marker",
};

// The three decisions as a group of toggle buttons, one of them pressed. Only a click, Enter or Space decides: the
// arrow keys (and Home and End) only move focus between them, so stepping from Shortlist to Undecided never records a
// "Not a fit" on the way, as radio buttons would. The group is one tab stop, on the chosen one until focus moves
// inside it. The chosen one has an ink border and, for a yes or a no, a ✓ or ✕, so colour is never the only signal.
// `hints` adds each one's shortcut as a keycap (for devices with a keyboard and a mouse).
export function DecisionSwitch({
	value,
	onChange,
	labelledBy,
	hints = false,
	stack = false,
}: {
	value: Decision;
	onChange: (decision: Decision) => void;
	labelledBy: string;
	hints?: boolean;
	// One option per row across the width (the side column), with the keycaps at the right.
	stack?: boolean;
}) {
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	// Which button holds the tab stop while focus is inside the group; outside it, the chosen one does.
	const [focused, setFocused] = useState<number | null>(null);
	const stop = focused ?? OPTIONS.findIndex((option) => option.value === value);

	const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
		const from = buttons.current.findIndex((button) => button === event.target);
		if (from === -1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const last = OPTIONS.length - 1;
		const to =
			event.key === "ArrowRight" || event.key === "ArrowDown"
				? from === last
					? 0
					: from + 1
				: event.key === "ArrowLeft" || event.key === "ArrowUp"
					? from === 0
						? last
						: from - 1
					: event.key === "Home"
						? 0
						: event.key === "End"
							? last
							: null;
		if (to === null) return;
		event.preventDefault();
		buttons.current[to]?.focus();
	};

	return (
		<div
			role="group"
			aria-labelledby={labelledBy}
			onKeyDown={moveFocus}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
			}}
			className={`gap-1 rounded-lg border border-line bg-paper-2 p-1 ${stack ? "grid" : "inline-grid grid-cols-3 max-[420px]:w-full"}`}
		>
			{OPTIONS.map((option, index) => {
				const chosen = option.value === value;
				return (
					<button
						key={option.value}
						ref={(button) => {
							buttons.current[index] = button;
						}}
						type="button"
						aria-pressed={chosen}
						aria-keyshortcuts={option.key.toUpperCase()}
						tabIndex={index === stop ? 0 : -1}
						onFocus={() => setFocused(index)}
						onClick={() => {
							if (!chosen) onChange(option.value);
						}}
						className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-[1.5px] px-3 text-[14px] font-semibold whitespace-nowrap ${stack ? "" : "justify-center max-[420px]:px-2"} ${chosen ? CHOSEN[option.mark ?? "plain"] : "border-transparent text-ink-muted hover:bg-sheet hover:text-ink"}`}
					>
						{/* The glyph has a fixed slot in the stacked list, so the words line up. */}
						{stack ? (
							<span aria-hidden="true" className="grid w-4 place-items-center">
								{chosen && option.mark === "yes" && <Check />}
								{chosen && option.mark === "no" && "✕"}
							</span>
						) : (
							<>
								{chosen && option.mark === "yes" && <Check />}
								{chosen && option.mark === "no" && <span aria-hidden="true">✕</span>}
							</>
						)}
						{option.label}
						{hints && (
							<span aria-hidden="true" className={`font-normal ${stack ? "ml-auto" : "ml-1"}`}>
								<Kbd>{option.key.toUpperCase()}</Kbd>
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

// "Grace Turner · Decided 22 Oct 2026". The decision stores a Clerk user id; names come from the team list, and
// until it loads only the date shows. Nothing while the candidate is undecided.
export function WhoDecided({ candidate, className = "" }: { candidate: Candidate; className?: string }) {
	const { userId } = useSession();
	const team = useTeam();
	if (candidate.decision === "undecided" || !candidate.decidedAt) return null;

	let who: string | null = null;
	if (candidate.decidedBy && candidate.decidedBy === userId) who = "You";
	else if (candidate.decidedBy && team.data) {
		const member = team.data.find((person) => person.userId === candidate.decidedBy);
		who = member ? displayName(member) : "Former member";
	}
	return (
		<p className={`font-mono text-[12.5px] text-ink-muted [overflow-wrap:anywhere] ${className}`}>
			{who ? `${who} · ` : ""}Decided {formatDate(candidate.decidedAt)}
		</p>
	);
}

// The recruiters' call on this CV: the switch, who made it and when, the actions beside it (`actions`: the email
// button and the overflow menu) and the API's reason when a change is refused. `bar` is one row that can stay at
// the top of the pane; `card` is the side column's card, with a visible heading.
export function DecisionBar({
	candidate,
	onChoose,
	error,
	hints,
	variant,
	headingLevel,
	menu,
	invite,
	className = "",
}: {
	candidate: Candidate;
	onChoose: (decision: Decision) => void;
	error: string | null;
	hints: boolean;
	variant: "bar" | "card";
	headingLevel: 2 | 3;
	menu: ReactNode;
	invite: ReactNode;
	className?: string;
}) {
	const headingId = useId();
	const Heading = headingLevel === 2 ? "h2" : "h3";
	const alert = error && (
		<p role="alert" className="mt-3 text-[14px] text-gap-ink">
			✕ {error}
		</p>
	);

	if (variant === "card") {
		return (
			<section aria-labelledby={headingId} className={`rounded-xl bg-sheet p-5 shadow-card ${className}`}>
				<div className="-mt-1.5 -mr-2 flex items-center justify-between gap-3">
					<Heading id={headingId} className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
						Decision
					</Heading>
					{menu}
				</div>
				<div className="mt-3">
					<DecisionSwitch value={candidate.decision} onChange={onChoose} labelledBy={headingId} hints={hints} stack />
				</div>
				<WhoDecided candidate={candidate} className="mt-3" />
				{invite && <div className="mt-4 [&_.btn]:w-full">{invite}</div>}
				{alert}
			</section>
		);
	}

	return (
		<section aria-labelledby={headingId} className={className}>
			<Heading id={headingId} className="sr-only">
				Decision
			</Heading>
			{/* One row when it fits; narrower, who decided and the actions share a second row under the switch. */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<DecisionSwitch value={candidate.decision} onChange={onChoose} labelledBy={headingId} hints={hints} />
				<div className="flex min-w-0 flex-[1_1_16rem] items-center gap-x-3 gap-y-1">
					<WhoDecided candidate={candidate} className="min-w-0" />
					<div className="ml-auto flex flex-none items-center gap-1">
						{invite}
						{menu}
					</div>
				</div>
			</div>
			{alert}
		</section>
	);
}

// The team's note on this CV. It saves itself a moment after you stop typing, when you leave the field and when the
// candidate changes, so nothing typed is lost by moving on. It shows the saved note until you type, so a teammate's
// save shows up; text typed while a save is on its way is kept.
export function NoteField({
	jobId,
	candidate,
	rows = 4,
	autoFocus = false,
	onDone,
	headingLevel,
}: {
	jobId: string;
	candidate: Candidate;
	rows?: number;
	autoFocus?: boolean;
	// Escape (and the Done button, which the caller draws) hands back to the collapsed note.
	onDone?: () => void;
	// With a level the label is a heading too, for the side column.
	headingLevel?: 2 | 3;
}) {
	const org = useOrg();
	const save = useDecideCandidate(jobId, candidate.id);
	const id = useId();
	const area = useRef<HTMLTextAreaElement>(null);
	const saved = candidate.note ?? "";
	// What has been typed. Null while the field shows the saved note.
	const [draft, setDraft] = useState<string | null>(null);
	const [justSaved, setJustSaved] = useState(false);
	const text = draft ?? saved;

	// The save runs from timers, blur and unmount, so it reads the latest values from refs.
	const latest = useRef({ save, saved });
	useLayoutEffect(() => {
		latest.current = { save, saved };
	});
	const unsent = useRef<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const alive = useRef(true);

	const flush = useCallback(() => {
		clearTimeout(timer.current);
		const sent = unsent.current;
		unsent.current = null;
		if (sent === null || sent.trim() === latest.current.saved) return;
		latest.current.save.mutateAsync({ note: sent }).then(
			() => {
				if (!alive.current || unsent.current !== null) return;
				setJustSaved(true);
				// Once you have left the field it shows the saved note again, so a teammate's change can come through.
				if (document.activeElement !== area.current) setDraft((current) => (current === sent ? null : current));
			},
			// The field says why below it.
			() => {},
		);
	}, []);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			flush();
		};
	}, [flush]);

	const type = (value: string) => {
		setDraft(value);
		setJustSaved(false);
		if (save.isError) save.reset();
		unsent.current = value;
		clearTimeout(timer.current);
		timer.current = setTimeout(flush, NOTE_SAVE_DELAY_MS);
	};

	const label = (
		<label htmlFor={id} className="block text-[14px] font-semibold text-ink">
			Note
		</label>
	);
	const Heading = headingLevel === 3 ? "h3" : "h2";

	return (
		<div>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				{headingLevel ? (
					<Heading className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%] [&_label]:text-[17px] [&_label]:font-[800]">
						{label}
					</Heading>
				) : (
					label
				)}
				<span className="font-mono text-[12px] text-ink-muted" aria-hidden="true">
					{formatNumber(text.length)} / {formatNumber(NOTE_MAX)}
				</span>
			</div>
			<textarea
				ref={area}
				id={id}
				className="field mt-2 resize-y leading-[1.55]"
				rows={rows}
				maxLength={NOTE_MAX}
				value={text}
				// Opened on purpose from "Add a note", so the field is where the recruiter is going.
				autoFocus={autoFocus}
				placeholder="Why they fit, what to ask, who should meet them"
				onChange={(event) => type(event.target.value)}
				onBlur={() => {
					if (unsent.current !== null) return flush();
					// Nothing left to send: a save that finished while the field had focus left the typing in place, so the
					// field goes back to the saved note and a teammate's later edit can show. Not while a save is on its way:
					// if it fails, the typing is what "Save again" sends.
					if (!save.isPending) setDraft((current) => (current?.trim() === saved ? null : current));
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						flush();
					} else if (event.key === "Escape" && onDone) {
						event.preventDefault();
						flush();
						onDone();
					}
				}}
				aria-describedby={`${id}-help`}
			/>
			<div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
				<p id={`${id}-help`} className="text-[13px] text-ink-muted">
					Everyone at {org.name} can read this. It saves as you type.
				</p>
				<p aria-live="polite" className="inline-flex min-h-5 items-center gap-1.5 font-mono text-[12.5px] text-ink">
					{save.isPending ? (
						"Saving"
					) : justSaved && !save.isError ? (
						<>
							<Check />
							<span>Saved</span>
						</>
					) : null}
				</p>
			</div>
			{save.isError && (
				<div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 text-[14px] text-gap-ink">
					<span>✕ The note isn't saved. {save.error.message}</span>
					<button
						type="button"
						className="min-h-11 rounded-[3px] px-1 font-semibold text-ink underline underline-offset-[.18em]"
						onClick={() => {
							save.reset();
							unsent.current = text;
							flush();
						}}
					>
						Save again
					</button>
				</div>
			)}
		</div>
	);
}

// The note in a pane that has no room to keep the field open: the note itself (or "Add a note"), opened into the
// field on request.
export function NoteToggle({ jobId, candidate }: { jobId: string; candidate: Candidate }) {
	const [open, setOpen] = useState(false);
	const toggle = useRef<HTMLButtonElement>(null);
	const close = () => {
		setOpen(false);
		// Back to the button that opened it, which is drawn again once the field is gone.
		requestAnimationFrame(() => toggle.current?.focus());
	};

	if (open) {
		return (
			<div>
				<NoteField jobId={jobId} candidate={candidate} rows={3} autoFocus onDone={close} />
				<button type="button" className="btn ghost xs mt-2" onClick={close}>
					Done
				</button>
			</div>
		);
	}
	if (!candidate.note) {
		return (
			<button ref={toggle} type="button" className="btn ghost xs" onClick={() => setOpen(true)}>
				<NotebookPen size={16} strokeWidth={2} aria-hidden="true" />
				Add a note
			</button>
		);
	}
	return (
		<div className="rounded-lg border border-line bg-sheet px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">Note</p>
				<button
					ref={toggle}
					type="button"
					className="-my-2 -mr-2 inline-flex min-h-11 items-center rounded-md px-2 text-[14px] font-semibold text-ink underline underline-offset-[.18em]"
					onClick={() => setOpen(true)}
				>
					Edit note
				</button>
			</div>
			<p className="mt-1 line-clamp-4 text-[15px] whitespace-pre-line text-ink-2 [overflow-wrap:anywhere]">{candidate.note}</p>
		</div>
	);
}
