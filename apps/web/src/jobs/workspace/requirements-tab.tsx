import { RUBRIC_MAX_ITEMS, RUBRIC_MIN_ITEMS, type RubricItem, visibleItems } from "@lucid-hire/scoring";
import type { UseQueryResult } from "@tanstack/react-query";
import { ListChecks, Plus, RefreshCw } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { useOrg } from "../../dashboard/org.ts";
import { ApiError } from "../../lib/api.ts";
import type { CandidateList, CandidateSummary } from "../../lib/candidates.ts";
import type { Job } from "../../lib/jobs.ts";
import { RUBRIC_ERRORS, type RubricChange, needsCheck, rubricErrorMessage } from "../../lib/rubric.ts";
import { type Moves, useCheckAll, useDraftRubric, useRubricChanges } from "../../lib/use-rubric.ts";
import { UpgradeAction } from "../../settings/upgrade.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { useToast } from "../../ui/use-toast.ts";
import { AddRequirementDialog } from "./add-requirement.tsx";
import { LiveRanking } from "./live-ranking.tsx";
import { RequirementRow } from "./requirement-row.tsx";
import type { MovesState } from "./use-moves.ts";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const PANEL_HEADING = "text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]";

// The job page's Requirements tab: the fixed list every CV is checked against. Before there is one it offers to draft
// it from the description; while it drafts it says so; if the draft failed it offers to try again. Once ready, it is
// the editor beside the live ranking.
export function RequirementsTab({
	job,
	candidates,
	moves,
	onMoves,
	onShowCandidates,
}: {
	job: Job;
	candidates: UseQueryResult<CandidateList>;
	moves: MovesState;
	onMoves: (moves: Moves) => void;
	onShowCandidates: () => void;
}) {
	const status = job.rubricStatus ?? "none";
	if (status === "drafting") return <Drafting redraft={Boolean(job.rubric)} />;
	if (status === "failed") return <DraftFailed jobId={job.id} />;
	if (status !== "ready" || !job.rubric) return <NoRequirements jobId={job.id} />;
	return (
		<RequirementsEditor
			job={job}
			rubric={job.rubric}
			list={candidates.data?.candidates ?? []}
			moves={moves}
			onMoves={onMoves}
			onShowCandidates={onShowCandidates}
		/>
	);
}

// A refused draft or check, in plain words. Running out of the hour's AI requests says how to get more.
function AiError({ error, className = "" }: { error: Error; className?: string }) {
	const org = useOrg();
	return (
		<div role="alert" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-gap-ink ${className}`}>
			<p>✕ {rubricErrorMessage(error)}</p>
			{error instanceof ApiError && error.code === "plan_limit" && <UpgradeAction isAdmin={org.role === "admin"} />}
		</div>
	);
}

function NoRequirements({ jobId }: { jobId: string }) {
	const draft = useDraftRubric(jobId);
	return (
		<div className="rounded-xl bg-sheet shadow-card">
			<EmptyState
				swipe
				title="Set up this job's requirements"
				illustration={<ListChecks size={44} strokeWidth={1.6} className="text-ink" />}
				actions={
					<button
						type="button"
						className="btn"
						aria-disabled={draft.isPending}
						onClick={() => {
							if (!draft.isPending) draft.mutate();
						}}
					>
						{draft.isPending ? "Starting" : "Set up requirements"}
					</button>
				}
			>
				We draft a short list from the job description, and every CV is checked against it. You choose what counts
				(Must, Nice or Off) and can change it any time.
			</EmptyState>
			{draft.isError && <AiError error={draft.error} className="justify-center px-6 pb-8" />}
		</div>
	);
}

// Calm, because nothing needs doing: the job is polled and the editor appears when the draft lands.
function Drafting({ redraft }: { redraft: boolean }) {
	return (
		<section aria-labelledby="drafting-h" className="flex max-w-[760px] flex-col gap-4">
			<h2 id="drafting-h" className={PANEL_HEADING}>
				Requirements
			</h2>
			<p role="status" className="inline-flex min-h-11 items-center gap-2.5 self-start rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card">
				<span className="live-dot" aria-hidden="true" />
				Drafting requirements from the description…
			</p>
			<p className="max-w-[60ch] text-[15px] text-ink-2">
				{redraft
					? "It takes a few seconds. The new list shows here when it's ready, and the scores follow it."
					: "It takes a few seconds. The list shows here when it's ready, and you can change it straight away."}
			</p>
			<div aria-hidden="true" className="flex flex-col gap-5 rounded-xl bg-sheet p-5 shadow-card">
				{[0, 1, 2, 3].map((row) => (
					<div key={row} className="flex items-center gap-4">
						<Skeleton className="h-3 w-4" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-3 w-2/3" />
						</div>
						<Skeleton className="h-9 w-40" />
					</div>
				))}
			</div>
		</section>
	);
}

function DraftFailed({ jobId }: { jobId: string }) {
	const draft = useDraftRubric(jobId);
	return (
		<div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
			<h2 className={PANEL_HEADING}>
				<span className="mk mk-gap">✕ We couldn't draft the requirements</span>
			</h2>
			<p className="text-[15px] text-ink-2">
				Check that the description says what the job needs, then try again. Nothing on the job has changed.
			</p>
			<button
				type="button"
				className="btn"
				aria-disabled={draft.isPending}
				onClick={() => {
					if (!draft.isPending) draft.mutate();
				}}
			>
				{draft.isPending ? "Starting" : "Try again"}
			</button>
			{draft.isError && <AiError error={draft.error} />}
			{/* The API can take the request and still fail to start the draft; the job comes back failed again. */}
			{draft.data?.rubricStatus === "failed" && (
				<p role="alert" className="text-[14px] text-gap-ink">
					✕ It didn't start this time either. Try again in a minute.
				</p>
			)}
		</div>
	);
}

// The editor: what the weights mean, Redraft and Add, the Check all prompt, the list itself, and the ranking beside it.
// Weight, name and remove changes show at once and save in the background (useRubricChanges); a refusal puts the
// page back and says why in a toast.
function RequirementsEditor({
	job,
	rubric,
	list,
	moves,
	onMoves,
	onShowCandidates,
}: {
	job: Job;
	rubric: RubricItem[];
	list: CandidateSummary[];
	moves: MovesState;
	onMoves: (moves: Moves) => void;
	onShowCandidates: () => void;
}) {
	const toast = useToast();
	const change = useRubricChanges(job.id);
	const items = visibleItems(rubric);
	const full = items.length >= RUBRIC_MAX_ITEMS;
	const [adding, setAdding] = useState(false);
	const [redrafting, setRedrafting] = useState(false);
	const [removing, setRemoving] = useState<RubricItem | null>(null);
	const listHeadingRef = useRef<HTMLHeadingElement>(null);
	// A run of changes that fails rejects each of them with the same error; it is said once.
	const said = useRef<unknown>(null);

	const apply = (changes: RubricChange[]) => {
		const { moves: moved, done } = change(changes);
		onMoves(moved);
		done.catch((error: unknown) => {
			if (error === said.current) return;
			said.current = error;
			toast.error(
				<>
					{rubricErrorMessage(error)} Your change <span className="mk mk-gap">wasn't saved</span>.
				</>,
			);
		});
	};

	const counts = { must: 0, nice: 0, off: 0 };
	for (const { weight } of items) counts[weight] += 1;

	return (
		<div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
			<section aria-labelledby="requirements-h" className="flex min-w-0 flex-col gap-4">
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<div className="min-w-0 flex-[1_1_360px]">
						<h2 id="requirements-h" ref={listHeadingRef} tabIndex={-1} className={`${PANEL_HEADING} focus:outline-none`}>
							Requirements
						</h2>
						<p className="mt-1.5 max-w-[64ch] text-[15px] text-ink-2">
							Every CV is checked against this list. Must counts three times as much as Nice, and Off doesn't count.
							Change one and every CV re-ranks at once: no AI, no waiting.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<button type="button" className="btn ghost xs" onClick={() => setRedrafting(true)}>
							<RefreshCw size={16} aria-hidden="true" />
							Redraft from description
						</button>
						<button type="button" className="btn xs" disabled={full} onClick={() => setAdding(true)}>
							<Plus size={16} aria-hidden="true" />
							Add requirement
						</button>
					</div>
				</div>
				<p className="font-mono text-[12.5px] text-ink-muted">
					{items.length} of {RUBRIC_MAX_ITEMS} requirements · {counts.must} must · {counts.nice} nice · {counts.off} off
					{full && " · the most a job can have. Remove one to add another."}
				</p>
				<CheckAll jobId={job.id} list={list} />
				<ol aria-label="Requirements" className="divide-y divide-line-2 rounded-xl bg-sheet shadow-card">
					{items.map((item, index) => (
						<RequirementRow
							key={item.id}
							item={item}
							index={index}
							onWeight={(weight) => apply([{ id: item.id, weight }])}
							onRename={(label) => apply([{ id: item.id, label }])}
							onRemove={() => {
								if (items.length <= RUBRIC_MIN_ITEMS) {
									toast.error(RUBRIC_ERRORS.rubric_empty);
									return;
								}
								setRemoving(item);
							}}
						/>
					))}
				</ol>
			</section>

			<div className="min-w-0 min-[1100px]:sticky min-[1100px]:top-0">
				<LiveRanking jobId={job.id} list={list} moves={moves} onShowAll={onShowCandidates} />
			</div>

			{adding && (
				<AddRequirementDialog
					jobId={job.id}
					count={items.length}
					onClose={() => setAdding(false)}
					onAdded={(label, moved) => {
						setAdding(false);
						onMoves(moved);
						toast.show(`Added “${label}”. Check the CVs against it so it counts.`);
					}}
				/>
			)}
			{removing && (
				<ConfirmDialog
					heading={`Remove “${removing.label}”?`}
					confirmLabel="Remove requirement"
					returnFocus={() => listHeadingRef.current}
					onCancel={() => setRemoving(null)}
					onConfirm={() => {
						apply([{ id: removing.id, removed: true }]);
						toast.show(`Removed “${removing.label}”. Every score is updated.`);
						setRemoving(null);
					}}
				>
					CVs stop being scored on it, and every score is worked out again at once. To bring it back, you'd add it
					again and check the CVs against it.
				</ConfirmDialog>
			)}
			{redrafting && <RedraftDialog jobId={job.id} onClose={() => setRedrafting(false)} />}
		</div>
	);
}

// "3 CVs not checked against all requirements", with Check all: one AI read per CV, confirmed first. While a run is
// going the rows' `checking` flags count it down and the button stays off.
function CheckAll({ jobId, list }: { jobId: string; list: CandidateSummary[] }) {
	const toast = useToast();
	const check = useCheckAll(jobId);
	const [confirming, setConfirming] = useState(false);
	const unchecked = list.filter(needsCheck).length;
	const checking = list.filter((row) => row.checking).length;
	if (unchecked === 0 && checking === 0 && !confirming) return null;

	let line: ReactNode = `${plural(unchecked, "CV")} not checked against all requirements.`;
	if (checking > 0) {
		line = (
			<>
				<span className="live-dot" aria-hidden="true" />
				Checking {plural(checking, "CV")} against every requirement…{unchecked > 0 && ` ${unchecked} more not checked yet.`}
			</>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-[1.5px] border-line bg-sheet px-4 py-2">
			<p role="status" className="inline-flex min-w-0 flex-[1_1_280px] flex-wrap items-center gap-x-2.5 py-1.5 text-[15px] text-ink-2">
				{line}
			</p>
			<button type="button" className="btn xs" disabled={checking > 0 || unchecked === 0} onClick={() => setConfirming(true)}>
				Check all
			</button>
			{confirming && (
				<ConfirmDialog
					heading={`Check ${plural(unchecked, "CV")} against every requirement?`}
					confirmLabel="Check all CVs"
					busyLabel="Starting"
					tone="primary"
					busy={check.isPending}
					error={check.isError ? rubricErrorMessage(check.error) : null}
					onCancel={() => {
						check.reset();
						setConfirming(false);
					}}
					onConfirm={() =>
						check.mutate(undefined, {
							onSuccess: (started) => {
								setConfirming(false);
								toast.show(`Checking ${plural(started, "CV")}. Scores update as each one finishes.`);
							},
						})
					}
				>
					Each one is read again by AI to find evidence for the requirements it hasn't been checked against: one AI read
					per CV. Their scores and places update as each one finishes.
				</ConfirmDialog>
			)}
		</div>
	);
}

// Drafting again replaces the list: requirements that come back unchanged keep their evidence, new ones need checking.
function RedraftDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
	const draft = useDraftRubric(jobId);
	return (
		<ConfirmDialog
			heading="Redraft the requirements?"
			confirmLabel="Redraft"
			busyLabel="Starting"
			busy={draft.isPending}
			error={draft.isError ? rubricErrorMessage(draft.error) : null}
			onCancel={onClose}
			onConfirm={() => draft.mutate(undefined, { onSuccess: onClose })}
		>
			We'll draft a new list from the job's title and description. Requirements that come back worded the same keep
			their evidence. Others, including ones you added, may be replaced, and new ones start as not checked, so the CVs
			will need checking against them.
		</ConfirmDialog>
	);
}
