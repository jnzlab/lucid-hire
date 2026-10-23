import { useBlocker } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import { useHotkeys } from "../lib/hotkeys.ts";
import { JOB_TITLE_MAX, JOB_TITLE_MIN, type Job, type JobInput, type JobStatus } from "../lib/jobs.ts";
import { useMediaQuery } from "../lib/use-media-query.ts";
import { useToastLift } from "../ui/use-toast-lift.ts";
import { CoverField } from "./cover-field.tsx";
import { BriefCheckCard } from "./editor/brief-check-card.tsx";
import { CandidateView } from "./editor/candidate-view.tsx";
import { type DescriptionTab, DescriptionField } from "./editor/description-field.tsx";
import { PublishActions, PublishCard } from "./editor/publish-card.tsx";
import { type EditorMode, statusChoices, submitLabel } from "./editor/publish.ts";
import { useRewrite } from "./editor/use-rewrite.ts";
import { type FieldErrors, NOTES_MISSING, isDirty, tidyInput, validateJob } from "./editor/validate.ts";

// From here the editor and the side column sit side by side, and the actions live in the Publish card; below it
// they sit in a bar stuck to the bottom of the screen.
const WIDE_QUERY = "(min-width: 1100px)";

type JobFormProps = {
	mode: EditorMode;
	// The saved job, on the edit page.
	job?: Job;
	onSave: (input: JobInput, status: JobStatus) => void;
	saving: boolean;
	saveError: Error | null;
	// Where Cancel goes: the jobs list for a new job, the job for an edit.
	cancelHref: string;
	// The month's job allowance, under the status (new job only).
	allowance?: ReactNode;
	// Why the job can't be saved (the month's jobs are used up), with the way to upgrade. Disables the save button.
	blocked?: ReactNode;
};

// The job editor (spec §4.3): title, description and cover on the left; Publish, Brief check and Candidate view in a
// sticky column on the right from 1100px. Unsaved typing is guarded against every way out, and Ctrl/⌘+Enter saves
// from anywhere in the form.
export function JobForm({ mode, job, onSave, saving, saveError, cancelHref, allowance, blocked }: JobFormProps) {
	const org = useOrg();
	const saved: JobInput = { title: job?.title ?? "", description: job?.description ?? "" };
	const [title, setTitle] = useState(saved.title);
	const [description, setDescription] = useState(saved.description);
	const [status, setStatus] = useState<JobStatus>(job?.status ?? "open");
	const [errors, setErrors] = useState<FieldErrors>({});
	const [tab, setTab] = useState<DescriptionTab>("write");
	const formRef = useRef<HTMLFormElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const wide = useMediaQuery(WIDE_QUERY, true);

	const rewrite = useRewrite({
		title,
		description,
		setDescription,
		onNoNotes: () => setErrors((found) => ({ ...found, description: NOTES_MISSING })),
	});

	// Unsaved typing is lost by leaving, whether by a link, Cancel, Back or closing the tab. The pages navigate with
	// `ignoreBlocker` after a save, so a save is never held up. A status flipped on a new job loses nothing.
	const dirty = isDirty({ title, description }, saved) || (mode === "edit" && status !== job?.status);
	const leaving = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: dirty, withResolver: true });

	const serverFields = saveError instanceof ApiError ? saveError.fields : {};
	const titleError = errors.title ?? serverFields.title;
	const descriptionError = errors.description ?? serverFields.description;
	const formError = saveError && !serverFields.title && !serverFields.description ? saveError.message : null;
	const label = submitLabel(mode, status, saving);

	// The description's field may be behind the Preview tab: bring it back before focusing it.
	const focusDescription = () => {
		if (tab !== "write") flushSync(() => setTab("write"));
		descriptionRef.current?.focus();
	};

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		// The save button only looks disabled while saving (aria-disabled), so a click can still submit.
		if (saving || blocked) return;
		const input = tidyInput({ title, description });
		const found = validateJob(input);
		setErrors(found);
		// Focus goes to the first field with a problem, so its message is read out and fixing it is one keystroke away.
		if (found.title) titleRef.current?.focus();
		else if (found.description) focusDescription();
		else onSave(input, status);
	};

	useHotkeys([
		{
			keys: "mod+Enter",
			label: mode === "edit" ? "Save changes" : status === "open" ? "Open the job" : "Save the draft",
			group: "This page",
			whileTyping: true,
			enabled: !blocked,
			run: () => formRef.current?.requestSubmit(),
		},
	]);

	const actions = (layout: "card" | "bar") => (
		<PublishActions
			layout={layout}
			label={label}
			arrow={mode === "new" && status === "open"}
			saving={saving}
			blocked={Boolean(blocked)}
			cancelHref={cancelHref}
			notices={
				(blocked || formError) && (
					<>
						{blocked}
						{formError && (
							<p role="alert" className="text-[14px] text-gap-ink">
								✕ {formError}
							</p>
						)}
					</>
				)
			}
		/>
	);

	return (
		<form
			ref={formRef}
			onSubmit={onSubmit}
			noValidate
			aria-label="Job details"
			className="@container grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_360px] min-[1100px]:gap-8"
		>
			<div className="flex min-w-0 flex-col gap-7 rounded-xl bg-sheet p-5 shadow-card min-[561px]:p-7">
				<div>
					<label htmlFor="job-title" className="block text-[14px] font-semibold text-ink">
						Job title
					</label>
					<input
						ref={titleRef}
						id="job-title"
						name="title"
						className="field mt-2 min-h-12 text-[20px] font-semibold"
						placeholder="Senior iOS Engineer"
						maxLength={JOB_TITLE_MAX}
						autoComplete="off"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						aria-invalid={Boolean(titleError)}
						aria-describedby={titleError ? "job-title-error" : "job-title-help"}
					/>
					{titleError ? (
						<p id="job-title-error" role="alert" className="mt-2 text-[13px] text-gap-ink">
							✕ {titleError}
						</p>
					) : (
						<p id="job-title-help" className="mt-2 text-[13px] text-ink-muted">
							{JOB_TITLE_MIN} to {JOB_TITLE_MAX} characters.
						</p>
					)}
				</div>

				<DescriptionField
					value={description}
					onChange={(text) => {
						rewrite.edited();
						setDescription(text);
					}}
					error={descriptionError}
					tab={tab}
					onTabChange={setTab}
					textareaRef={descriptionRef}
					saving={saving}
					rewrite={{ ...rewrite, improve: () => rewrite.improve(saving) }}
				/>

				<div className="border-t border-line-2 pt-6">
					{job ? (
						<CoverField job={job} />
					) : (
						<>
							<p className="text-[14px] font-semibold text-ink">Cover image</p>
							<p className="mt-1 text-[13px] text-ink-muted">Optional. You can add one from Edit job once the job is saved.</p>
						</>
					)}
				</div>
			</div>

			{/* On a tablet the side cards pair up under the editor; from 1100px they stack in the sticky column. */}
			<div className="grid min-w-0 items-start gap-6 @min-[640px]:grid-cols-2 min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:flex min-[1100px]:flex-col">
				<PublishCard choices={statusChoices(mode, job?.status)} status={status} onStatus={setStatus} allowance={allowance}>
					{wide && actions("card")}
				</PublishCard>
				<BriefCheckCard description={description} />
				<div className="min-w-0 @min-[640px]:col-span-2">
					<CandidateView title={title} status={status} company={org.name} job={job} />
				</div>
			</div>

			{!wide && <SaveBar>{actions("bar")}</SaveBar>}

			{leaving.status === "blocked" && (
				<ConfirmDialog
					heading="Leave without saving?"
					cancelLabel="Keep editing"
					confirmLabel="Leave"
					onCancel={leaving.reset}
					onConfirm={leaving.proceed}
				>
					Your changes to this job aren't saved.
				</ConfirmDialog>
			)}
		</form>
	);
}

// The save buttons stuck to the bottom of a narrow screen. Toasts rise above it while it's there.
function SaveBar({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	useToastLift(ref);
	return (
		<div
			ref={ref}
			className="sticky bottom-[calc(64px+12px+env(safe-area-inset-bottom,0px))] z-[60] rounded-xl border border-line bg-sheet p-3 shadow-float md:bottom-3"
		>
			{children}
		</div>
	);
}
