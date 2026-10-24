import { LABEL_MAX, type RubricItem, type Weight } from "@lucid-hire/scoring";
import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { checkLabel } from "../../lib/rubric.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { SegmentedControl } from "../../ui/segmented-control.tsx";
import { WEIGHT_SEGMENTS } from "./weights.ts";

// One requirement in the editor: its number (the order of the squares on every row), its label with Rename, what a CV
// is checked against, the Must / Nice / Off choice and Remove. The choice is a real radio group named by the label,
// so arrow keys move through it and screen readers hear "SwiftUI, Must, 1 of 3". An Off requirement is dimmed.
export function RequirementRow({
	item,
	index,
	onWeight,
	onRename,
	onRemove,
}: {
	item: RubricItem;
	index: number;
	onWeight: (weight: Weight) => void;
	onRename: (label: string) => void;
	onRemove: () => void;
}) {
	const labelId = useId();
	const [renaming, setRenaming] = useState(false);
	const renameRef = useRef<HTMLButtonElement>(null);
	// Focus goes back to Rename when the field closes, so the keyboard carries on from the same place.
	const refocus = useRef(false);
	useEffect(() => {
		if (renaming || !refocus.current) return;
		refocus.current = false;
		renameRef.current?.focus();
	}, [renaming]);
	const close = () => {
		refocus.current = true;
		setRenaming(false);
	};
	const off = item.weight === "off";

	return (
		<li
			data-requirement={item.id}
			className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-3.5 min-[700px]:grid-cols-[24px_minmax(0,1fr)_auto] min-[700px]:items-center"
		>
			<span aria-hidden="true" className="self-start pt-[11px] font-mono text-[12px] leading-none text-ink-faint tabular-nums">
				{index + 1}
			</span>
			<div className="min-w-0">
				{renaming ? (
					<>
						<span id={labelId} className="sr-only">
							{item.label}
						</span>
						<RenameForm
							label={item.label}
							onSave={(label) => {
								onRename(label);
								close();
							}}
							onCancel={close}
						/>
					</>
				) : (
					<div className="flex min-w-0 items-center gap-0.5">
						<span
							id={labelId}
							className={`min-w-0 text-[16px] leading-[1.25] font-[750] [overflow-wrap:anywhere] [font-stretch:104%] ${off ? "text-ink-muted" : "text-ink"}`}
						>
							{item.label}
						</span>
						<IconButton
							ref={renameRef}
							label={`Rename ${item.label}`}
							tooltip="Rename"
							icon={<Pencil size={16} strokeWidth={2} aria-hidden="true" />}
							className="-my-2"
							onClick={() => setRenaming(true)}
						/>
					</div>
				)}
				<p className={`text-[14px] leading-[1.45] text-ink-muted [overflow-wrap:anywhere] ${off ? "opacity-75" : ""}`}>{item.detail}</p>
			</div>
			<div className="col-start-2 flex flex-wrap items-center gap-1 min-[700px]:col-start-3">
				<SegmentedControl
					name={`weight-${item.id}`}
					labelledBy={labelId}
					value={item.weight}
					segments={WEIGHT_SEGMENTS}
					onChange={onWeight}
					compact
				/>
				<IconButton
					label={`Remove ${item.label}`}
					tooltip="Remove"
					icon={<Trash2 size={18} strokeWidth={2} aria-hidden="true" />}
					onClick={onRemove}
				/>
			</div>
		</li>
	);
}

// The label as a field: Enter or Save keeps it, Escape or Cancel puts it back. Same rule as the API: 1 to 40
// characters once trimmed.
function RenameForm({ label, onSave, onCancel }: { label: string; onSave: (label: string) => void; onCancel: () => void }) {
	const [value, setValue] = useState(label);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const helpId = useId();
	const errorId = useId();
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const problem = checkLabel(value);
		if (problem) {
			setError(problem);
			inputRef.current?.focus();
			return;
		}
		if (value.trim() === label) onCancel();
		else onSave(value.trim());
	};

	return (
		<form onSubmit={submit} noValidate className="flex flex-wrap items-center gap-2">
			<input
				ref={inputRef}
				aria-label={`New name for ${label}`}
				className="field min-w-0 flex-[1_1_200px] min-[700px]:max-w-[320px]"
				value={value}
				maxLength={LABEL_MAX}
				autoComplete="off"
				onChange={(event) => {
					setValue(event.target.value);
					setError(null);
				}}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				}}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : helpId}
			/>
			<button type="submit" className="btn xs">
				Save
			</button>
			<button type="button" className="btn ghost xs" onClick={onCancel}>
				Cancel
			</button>
			{error ? (
				<p id={errorId} role="alert" className="basis-full text-[13px] text-gap-ink">
					✕ {error}
				</p>
			) : (
				<p id={helpId} className="basis-full font-mono text-[12px] text-ink-muted tabular-nums">
					{value.trim().length} / {LABEL_MAX} characters
				</p>
			)}
		</form>
	);
}
