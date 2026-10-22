import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { ApiError } from "../lib/api.ts";
import {
	JOB_DESCRIPTION_MAX,
	JOB_TITLE_HINT,
	JOB_TITLE_MAX,
	JOB_TITLE_MIN,
	type JobInput,
	useEnhanceDescription,
} from "../lib/jobs.ts";

type FieldErrors = { title?: string; description?: string };

const tidyTitle = (title: string) => title.trim().replace(/\s+/g, " ");

// The same rules the API applies, checked before anything is sent.
function validate({ title, description }: JobInput): FieldErrors {
	const errors: FieldErrors = {};
	if (title.length < JOB_TITLE_MIN || title.length > JOB_TITLE_MAX) errors.title = JOB_TITLE_HINT;
	if (!description) errors.description = "Describe the role: what they'll do and what they need";
	else if (description.length > JOB_DESCRIPTION_MAX)
		errors.description = "Keep the description to 20,000 characters or fewer";
	return errors;
}

type JobFormProps = {
	initial?: JobInput;
	// Renders the submit buttons. Each one passes its intent back through `onSave`.
	actions: (state: { saving: boolean }) => ReactNode;
	onSave: (input: JobInput, intent: string) => void;
	saving: boolean;
	saveError: Error | null;
};

export function JobForm({ initial, actions, onSave, saving, saveError }: JobFormProps) {
	const [title, setTitle] = useState(initial?.title ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [errors, setErrors] = useState<FieldErrors>({});
	// The notes as they were before "Improve with AI", so the rewrite can be undone.
	const [beforeRewrite, setBeforeRewrite] = useState<string | null>(null);
	const enhance = useEnhanceDescription();
	const titleRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	const serverFields = saveError instanceof ApiError ? saveError.fields : {};
	const titleError = errors.title ?? serverFields.title;
	const descriptionError = errors.description ?? serverFields.description;
	const formError = saveError && !serverFields.title && !serverFields.description ? saveError.message : null;

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		// The save buttons only look disabled while saving (aria-disabled), so a click can still submit.
		if (saving) return;
		const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
		const input = { title: tidyTitle(title), description: description.trim() };
		const found = validate(input);
		setErrors(found);
		// Focus goes to the first field with a problem, so its message is read out and fixing it is one keystroke away.
		if (found.title) titleRef.current?.focus();
		else if (found.description) descriptionRef.current?.focus();
		else onSave(input, submitter?.value ?? "save");
	};

	const improve = () => {
		if (enhance.isPending || saving) return;
		const notes = description.trim();
		if (!notes) {
			setErrors({ ...errors, description: "Write a few notes first, then improve them" });
			return;
		}
		setErrors({ ...errors, description: undefined });
		const cleanTitle = tidyTitle(title);
		enhance.mutate(
			{ title: cleanTitle.length >= JOB_TITLE_MIN ? cleanTitle : undefined, description: notes },
			{
				onSuccess: (rewritten) => {
					setBeforeRewrite(description);
					setDescription(rewritten);
				},
			},
		);
	};

	const undo = () => {
		if (beforeRewrite === null) return;
		setDescription(beforeRewrite);
		setBeforeRewrite(null);
	};

	return (
		<form onSubmit={onSubmit} noValidate aria-label="Job details" className="max-w-[760px]">
			<div className="rounded-xl bg-sheet p-6 shadow-card min-[561px]:p-8">
				<label htmlFor="job-title" className="block text-[14px] font-semibold text-ink">
					Job title
				</label>
				<input
					ref={titleRef}
					id="job-title"
					name="title"
					className="field mt-2"
					placeholder="Senior iOS Engineer"
					maxLength={JOB_TITLE_MAX}
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

				<div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
					<label htmlFor="job-description" className="block text-[14px] font-semibold text-ink">
						Description
					</label>
					<span className="font-mono text-[12px] text-ink-muted" aria-hidden="true">
						{description.length.toLocaleString("en-US")} / {JOB_DESCRIPTION_MAX.toLocaleString("en-US")}
					</span>
				</div>
				<textarea
					ref={descriptionRef}
					id="job-description"
					name="description"
					className="field mt-2 min-h-[320px] resize-y leading-[1.55]"
					placeholder="What they'll do, what they need, what would be a plus. Rough notes are fine."
					maxLength={JOB_DESCRIPTION_MAX}
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					readOnly={enhance.isPending}
					aria-invalid={Boolean(descriptionError)}
					aria-describedby={descriptionError ? "job-description-error" : "job-description-help"}
				/>
				{descriptionError ? (
					<p id="job-description-error" role="alert" className="mt-2 text-[13px] text-gap-ink">
						✕ {descriptionError}
					</p>
				) : (
					<p id="job-description-help" className="mt-2 text-[13px] text-ink-muted">
						Every CV for this job is scored against it, so name the skills that matter.
					</p>
				)}

				<div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-paper p-3 shadow-[0_1px_0_var(--line)]">
					{/* Only looks disabled while it works, so it keeps keyboard focus; improve() ignores the click. */}
					<button
						type="button"
						className="btn ghost"
						onClick={improve}
						aria-disabled={enhance.isPending || saving}
					>
						{enhance.isPending ? "Rewriting" : "Improve with AI"}
					</button>
					{enhance.isPending ? (
						<p role="status" className="inline-flex items-center gap-2.5 font-mono text-[13px] text-ink">
							<span className="live-dot" aria-hidden="true" />
							Rewriting the description · this can take up to a minute
						</p>
					) : enhance.isError ? (
						<p role="alert" className="text-[13px] text-gap-ink">
							✕ {enhance.error.message}
						</p>
					) : beforeRewrite !== null ? (
						<>
							<p role="status" className="inline-flex items-center gap-2 font-mono text-[13px] text-ink">
								<Check /> Rewritten with AI. Read it before you save.
							</p>
							<button
								type="button"
								className="min-h-11 rounded-[3px] px-1 text-[14px] font-semibold underline underline-offset-[.18em]"
								onClick={undo}
							>
								Undo
							</button>
						</>
					) : (
						<p className="text-[13px] text-ink-muted">Turns rough notes into clear sections. You can undo it.</p>
					)}
				</div>
			</div>

			{formError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {formError}
				</p>
			)}
			<div className="mt-6 flex flex-wrap items-center justify-end gap-3">{actions({ saving })}</div>
		</form>
	);
}
