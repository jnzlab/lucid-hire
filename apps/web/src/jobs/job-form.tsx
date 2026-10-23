import { useBlocker } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useDeferredValue, useRef, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Check } from "../components/icons.tsx";
import { Markdown } from "../components/markdown-lazy.tsx";
import { ApiError } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";
import { UpgradeLink } from "../settings/upgrade.tsx";
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

// What a candidate will read on the public page, drawn from the form as it is typed. The description is deferred so
// typing stays quick while a long Markdown text is redrawn.
function CandidateView({ title, description }: { title: string; description: string }) {
	const text = useDeferredValue(description);
	return (
		<section aria-labelledby="candidate-view-h" className="min-w-0">
			<h2 id="candidate-view-h" className="font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">
				Candidate view
			</h2>
			<div className="desk mt-3 rounded-2xl p-[clamp(12px,3vw,24px)]">
				<div className="rounded-sheet bg-sheet p-[clamp(18px,3vw,32px)] shadow-sheet">
					<p className="inline-flex min-h-7 items-center gap-2 rounded-md border border-line bg-sheet px-2.5 font-mono text-[12.5px] text-ink">
						<i className="size-2 rounded-full bg-ink" aria-hidden="true" />
						Open role
					</p>
					<p
						className={`mt-3 font-display text-[clamp(24px,3vw,34px)] leading-[1.02] font-[820] tracking-[-0.03em] [overflow-wrap:anywhere] [font-stretch:112%] ${title.trim() ? "" : "text-ink-faint"}`}
					>
						{title.trim() || "Job title"}
					</p>
					<div className="mt-5">
						{text.trim() ? (
							<Markdown>{text}</Markdown>
						) : (
							<p className="text-[15px] text-ink-muted">Your description appears here as you type. Markdown works.</p>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

type JobFormProps = {
	initial?: JobInput;
	// Renders the submit buttons. Each one passes its intent back through `onSave`.
	actions: (state: { saving: boolean }) => ReactNode;
	onSave: (input: JobInput, intent: string) => void;
	saving: boolean;
	saveError: Error | null;
	// Shown above the buttons, such as the monthly job allowance.
	notice?: ReactNode;
};

export function JobForm({ initial, actions, onSave, saving, saveError, notice }: JobFormProps) {
	const [title, setTitle] = useState(initial?.title ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [errors, setErrors] = useState<FieldErrors>({});
	// In a narrow content area the form and the candidate view take turns; with room for both they sit side by side.
	const [tab, setTab] = useState<"compose" | "preview">("compose");
	// The notes as they were before "Improve with AI", so the rewrite can be undone.
	const [beforeRewrite, setBeforeRewrite] = useState<string | null>(null);
	const enhance = useEnhanceDescription();
	const titleRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	// Unsaved typing is lost by leaving, whether by a link, Cancel, Back or closing the tab. The pages navigate with
	// `ignoreBlocker` after a save, so a save is never held up.
	const dirty = tidyTitle(title) !== (initial?.title ?? "") || description.trim() !== (initial?.description ?? "").trim();
	const leaving = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: dirty, withResolver: true });

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

	// The preview sits beside the form only when the content area leaves it 300px (760 + 32 + 300); the sidebar takes
	// part of the window, so this measures the content area instead of the window. Narrower, it is a tab.
	return (
		<div className="@container">
			<div className="grid items-start gap-8 @min-[1092px]:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
				<div className="min-w-0">
					<div role="tablist" aria-label="Job form view" className="mb-4 flex gap-2 @min-[1092px]:hidden">
						{(["compose", "preview"] as const).map((name) => (
							<button
								key={name}
								type="button"
								role="tab"
								id={`job-tab-${name}`}
								aria-selected={tab === name}
								aria-controls={name === "compose" ? "job-compose" : "job-preview"}
								className={`min-h-11 flex-1 rounded-lg border-2 px-4 text-[15px] font-semibold ${tab === name ? "border-ink bg-ink text-paper" : "border-line bg-sheet text-ink"}`}
								onClick={() => setTab(name)}
							>
								{name === "compose" ? "Compose" : "Preview"}
							</button>
						))}
					</div>
					<form onSubmit={onSubmit} noValidate aria-label="Job details" id="job-compose" className={tab === "compose" ? "" : "@max-[1092px]:hidden"}>
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
									{formatNumber(description.length)} / {formatNumber(JOB_DESCRIPTION_MAX)}
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
										{enhance.error instanceof ApiError && enhance.error.code === "plan_limit" && (
											<>
												{" "}
												<UpgradeLink />
											</>
										)}
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
			
						{notice}
						{formError && (
							<p role="alert" className="mt-4 text-[14px] text-gap-ink">
								✕ {formError}
							</p>
						)}
						<div className="mt-6 flex flex-wrap items-center justify-end gap-3">{actions({ saving })}</div>
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
				</div>
				<div id="job-preview" className={`@min-[1092px]:sticky @min-[1092px]:top-24 ${tab === "preview" ? "" : "@max-[1092px]:hidden"}`}>
					<CandidateView title={title} description={description} />
				</div>
			</div>
		</div>
	);
}
