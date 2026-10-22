import { useId, useState } from "react";
import { Check } from "../components/icons.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type Candidate, DECISION_LABEL, type Decision, NOTE_MAX, useDecideCandidate } from "../lib/candidates.ts";
import { formatDate, formatNumber } from "../lib/format.ts";
import { useSession } from "../lib/session.ts";
import { displayName, useTeam } from "../lib/team.ts";
import { type Segment, SegmentedControl } from "./segmented-control.tsx";

const SEGMENTS: Segment<Decision>[] = [
	{ value: "undecided", label: DECISION_LABEL.undecided },
	{ value: "shortlisted", label: DECISION_LABEL.shortlisted, mark: "yes" },
	{ value: "rejected", label: DECISION_LABEL.rejected, mark: "no" },
];

// The recruiters' call on this CV, and a note on why. Anyone at the company can change both. A change shows
// at once and is put back, with the API's reason, if it is refused.
export function DecisionBlock({ jobId, candidate }: { jobId: string; candidate: Candidate }) {
	const decide = useDecideCandidate(jobId, candidate.id);
	const name = useId();
	// What screen readers are told after a choice. The region stays on the page, so a change is announced.
	const [announcement, setAnnouncement] = useState("");

	const choose = (decision: Decision) => {
		setAnnouncement(`Marked as ${decision}`);
		decide.mutate({ decision }, { onError: () => setAnnouncement("") });
	};

	return (
		<section aria-labelledby="decision-h" className="mt-10">
			<h2 id="decision-h" className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				Decision
			</h2>
			<SegmentedControl
				name={name}
				labelledBy="decision-h"
				value={candidate.decision}
				segments={SEGMENTS}
				onChange={choose}
				className="mt-4"
			/>
			<WhoDecided candidate={candidate} />
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			{decide.isError && (
				<p role="alert" className="mt-3 text-[14px] text-gap-ink">
					✕ {decide.error.message}
				</p>
			)}
			<NoteField jobId={jobId} candidate={candidate} />
		</section>
	);
}

// "Grace Turner · Decided 22 Oct 2026". The decision stores a Clerk user id; names come from the team list.
function WhoDecided({ candidate }: { candidate: Candidate }) {
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
		<p className="mt-3 font-mono text-[12.5px] text-ink-muted [overflow-wrap:anywhere]">
			{who ? `${who} · ` : ""}Decided {formatDate(candidate.decidedAt)}
		</p>
	);
}

function NoteField({ jobId, candidate }: { jobId: string; candidate: Candidate }) {
	const org = useOrg();
	const save = useDecideCandidate(jobId, candidate.id);
	const id = useId();
	const saved = candidate.note ?? "";
	// What has been typed and not saved yet. Null while the field shows the saved note, so a note a teammate
	// saves meanwhile shows up.
	const [draft, setDraft] = useState<string | null>(null);
	const [justSaved, setJustSaved] = useState(false);
	const text = draft ?? saved;
	const changed = draft !== null && draft.trim() !== saved;

	const submit = () => {
		if (draft === null || save.isPending) return;
		const sent = draft;
		save.mutate(
			{ note: sent },
			{
				onSuccess: () => {
					// Keep whatever was typed since.
					setDraft((current) => (current === sent ? null : current));
					setJustSaved(true);
				},
			},
		);
	};

	return (
		<div className="mt-6 max-w-[62ch]">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<label htmlFor={id} className="block text-[14px] font-semibold text-ink">
					Note
				</label>
				<span className="font-mono text-[12px] text-ink-muted" aria-hidden="true">
					{formatNumber(text.length)} / {formatNumber(NOTE_MAX)}
				</span>
			</div>
			<textarea
				id={id}
				className="field mt-2 resize-y leading-[1.55]"
				rows={4}
				maxLength={NOTE_MAX}
				value={text}
				onChange={(event) => {
					setDraft(event.target.value);
					setJustSaved(false);
					if (save.isError) save.reset();
				}}
				aria-describedby={`${id}-help`}
			/>
			<p id={`${id}-help`} className="mt-2 text-[13px] text-ink-muted">
				Everyone at {org.name} can read this.
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
				{/* Disabled while there is nothing to save. While saving it only looks disabled, so it keeps keyboard
				    focus; the note is shown as saved at once, so `changed` is already false by then. */}
				<button
					type="button"
					className="btn"
					disabled={!changed && !save.isPending}
					aria-disabled={save.isPending}
					onClick={submit}
				>
					{save.isPending ? "Saving" : "Save note"}
				</button>
				<p aria-live="polite" className="inline-flex items-center gap-1.5 font-mono text-[12.5px] text-ink">
					{justSaved && !changed && (
						<>
							<Check />
							<span>Saved</span>
						</>
					)}
				</p>
			</div>
			{save.isError && (
				<p role="alert" className="mt-3 text-[14px] text-gap-ink">
					✕ {save.error.message}
				</p>
			)}
		</div>
	);
}
