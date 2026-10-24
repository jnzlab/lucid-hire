import { DETAIL_MAX, LABEL_MAX, RUBRIC_MAX_ITEMS, type Weight } from "@lucid-hire/scoring";
import { type FormEvent, useId, useRef, useState } from "react";
import { ApiError } from "../../lib/api.ts";
import { checkDetail, checkLabel, rubricErrorMessage } from "../../lib/rubric.ts";
import { type Moves, useAddRequirement } from "../../lib/use-rubric.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { SegmentedControl } from "../../ui/segmented-control.tsx";
import { WEIGHT_SEGMENTS } from "./weights.ts";

// Adds a requirement: a short name for the list, what a CV should show (what it is checked against) and how much it
// counts. Nice to have by default, the smallest change to the ranking. The same limits as the API, shown as you type.
export function AddRequirementDialog({
	jobId,
	count,
	onClose,
	onAdded,
}: {
	jobId: string;
	// How many requirements the job shows now.
	count: number;
	onClose: () => void;
	onAdded: (label: string, moves: Moves) => void;
}) {
	const add = useAddRequirement(jobId);
	const formId = useId();
	const weightId = useId();
	const [label, setLabel] = useState("");
	const [detail, setDetail] = useState("");
	const [weight, setWeight] = useState<Weight>("nice");
	const [problems, setProblems] = useState<{ label?: string; detail?: string }>({});
	const labelRef = useRef<HTMLInputElement>(null);
	const detailRef = useRef<HTMLTextAreaElement>(null);
	// The API's per-field messages, for a field it refused.
	const fields = add.error instanceof ApiError ? add.error.fields : {};
	const labelError = problems.label ?? fields.label;
	const detailError = problems.detail ?? fields.detail;
	const formError = add.isError && !fields.label && !fields.detail ? rubricErrorMessage(add.error) : null;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (add.isPending) return;
		const found = { label: checkLabel(label) ?? undefined, detail: checkDetail(detail) ?? undefined };
		setProblems(found);
		if (found.label) return labelRef.current?.focus();
		if (found.detail) return detailRef.current?.focus();
		add.mutate({ label, detail, weight }, { onSuccess: ({ moves }) => onAdded(label.trim(), moves) });
	};

	return (
		<Dialog
			title="Add a requirement"
			description={`It starts as not checked on every CV, so it counts as missing until you check the CVs against it. This job has ${count} of ${RUBRIC_MAX_ITEMS}.`}
			onClose={onClose}
			dismissable={!add.isPending}
			footer={
				<>
					<button
						type="button"
						className="btn ghost"
						aria-disabled={add.isPending}
						onClick={() => {
							if (!add.isPending) onClose();
						}}
					>
						Cancel
					</button>
					<button type="submit" form={formId} className="btn" aria-disabled={add.isPending}>
						{add.isPending ? "Adding" : "Add requirement"}
					</button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
				<div>
					<label htmlFor={`${formId}-label`} className="block text-[14px] font-semibold text-ink">
						Name
					</label>
					<input
						ref={labelRef}
						id={`${formId}-label`}
						className="field mt-2"
						placeholder="SwiftUI"
						maxLength={LABEL_MAX}
						autoComplete="off"
						data-autofocus
						value={label}
						onChange={(event) => {
							setLabel(event.target.value);
							setProblems((now) => ({ ...now, label: undefined }));
						}}
						aria-invalid={Boolean(labelError)}
						aria-describedby={`${formId}-label-help`}
					/>
					<FieldHelp id={`${formId}-label-help`} error={labelError} length={label.trim().length} max={LABEL_MAX}>
						Short, as it shows on the list.
					</FieldHelp>
				</div>
				<div>
					<label htmlFor={`${formId}-detail`} className="block text-[14px] font-semibold text-ink">
						What a CV should show
					</label>
					<textarea
						ref={detailRef}
						id={`${formId}-detail`}
						className="field mt-2 min-h-24 resize-y [field-sizing:content]"
						placeholder="Shipped at least one app built with SwiftUI"
						maxLength={DETAIL_MAX}
						value={detail}
						onChange={(event) => {
							setDetail(event.target.value);
							setProblems((now) => ({ ...now, detail: undefined }));
						}}
						aria-invalid={Boolean(detailError)}
						aria-describedby={`${formId}-detail-help`}
					/>
					<FieldHelp id={`${formId}-detail-help`} error={detailError} length={detail.trim().length} max={DETAIL_MAX}>
						Each CV is checked against this.
					</FieldHelp>
				</div>
				<div>
					<p id={weightId} className="text-[14px] font-semibold text-ink">
						How much it counts
					</p>
					<SegmentedControl
						name={`${formId}-weight`}
						labelledBy={weightId}
						value={weight}
						segments={WEIGHT_SEGMENTS}
						onChange={setWeight}
						compact
						className="mt-2"
					/>
					<p className="mt-2 text-[13px] text-ink-muted">Must counts three times as much as Nice. Off doesn't count.</p>
				</div>
				{formError && (
					<p role="alert" className="text-[14px] text-gap-ink">
						✕ {formError}
					</p>
				)}
			</form>
		</Dialog>
	);
}

// Under a field: its error, or a hint and how many of its characters are used.
function FieldHelp({
	id,
	error,
	length,
	max,
	children,
}: {
	id: string;
	error: string | undefined;
	length: number;
	max: number;
	children: string;
}) {
	return (
		<div id={id} className="mt-2 flex items-start justify-between gap-4">
			{error ? (
				<p role="alert" className="text-[13px] text-gap-ink">
					✕ {error}
				</p>
			) : (
				<p className="text-[13px] text-ink-muted">{children}</p>
			)}
			<span className="flex-none font-mono text-[12px] text-ink-muted tabular-nums">
				{length} / {max}
			</span>
		</div>
	);
}
