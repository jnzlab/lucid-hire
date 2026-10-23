import { FileUp } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { type Uploads, isPending, summarise } from "../jobs/workspace/uploads.ts";
import { APPLICANT_NAME_MAX, CV_MAX_BYTES, type UploadItem } from "../lib/candidates.ts";
import { useCoarsePointer } from "../lib/use-coarse-pointer.ts";
import { Checkbox } from "../ui/checkbox.tsx";
import { ROW_ACTION } from "./row-action.ts";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

// What to say about a file while it goes up, and after. A file that is uploading shows how far along it is, in a bar
// and in words; the bar is for the eyes, the percentage is what a screen reader gets.
function UploadState({ item }: { item: UploadItem }) {
	if (item.state === "failed") return <span className="text-gap-ink">✕ {item.error}</span>;
	if (item.state === "done")
		return (
			<span className="inline-flex items-center gap-1.5 text-ink">
				<Check /> Uploaded
			</span>
		);
	if (item.state === "staged") return null;
	if (item.state === "waiting") return <span className="text-ink-muted">Waiting</span>;
	const percent = item.progress ?? 0;
	return (
		<span className="inline-flex items-center gap-2 text-ink-muted">
			Uploading
			<span
				role="progressbar"
				aria-label={`Uploading ${item.fileName}`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				className="block h-2 w-20 overflow-hidden rounded-[4px] bg-line"
			>
				<span className="block h-full bg-ink transition-[width] duration-200" style={{ width: `${percent}%` }} />
			</span>
			<span className="tabular-nums">{percent}%</span>
		</span>
	);
}

// The optional name and email for a file that is about to be uploaded. Blank means the CV's own are used.
function DetailFields({
	item,
	onEdit,
}: {
	item: UploadItem;
	onEdit: (change: { name?: string; email?: string }) => void;
}) {
	const nameId = useId();
	const emailId = useId();
	const errorId = useId();
	return (
		<div className="mt-2 grid w-full gap-2 font-sans min-[420px]:grid-cols-2">
			<div>
				<label htmlFor={nameId} className="font-mono text-[12px] text-ink-muted">
					Name<span className="sr-only"> for {item.fileName}</span>
				</label>
				<input
					id={nameId}
					className="field mt-1"
					type="text"
					autoComplete="off"
					maxLength={APPLICANT_NAME_MAX}
					placeholder="Read from the CV"
					value={item.name}
					onChange={(event) => onEdit({ name: event.target.value })}
				/>
			</div>
			<div>
				<label htmlFor={emailId} className="font-mono text-[12px] text-ink-muted">
					Email<span className="sr-only"> for {item.fileName}</span>
				</label>
				<input
					id={emailId}
					className="field mt-1"
					type="email"
					autoComplete="off"
					placeholder="Read from the CV"
					value={item.email}
					aria-invalid={item.detailError ? true : undefined}
					aria-describedby={item.detailError ? errorId : undefined}
					onChange={(event) => onEdit({ email: event.target.value })}
				/>
			</div>
			{item.detailError && (
				<p id={errorId} role="alert" className="text-[13px] text-gap-ink min-[420px]:col-span-2">
					✕ {item.detailError}
				</p>
			)}
		</div>
	);
}

// Drop PDFs on the zone or pick them with the button (it lives in the job page's upload drawer). With "Add a name or
// email" on, chosen files wait in a list with optional fields until "Upload" sends them; otherwise they go at once.
// Each file's result, or the reason it was refused, then takes its place. When the job can't take CVs the `note` says
// why and takes the place of the chooser, but the results of the last batch stay.
export function UploadZone({
	uploads: { items, choose, edit, upload, remove, retry, clear },
	withDetails,
	onWithDetailsChange,
	note,
	noteAction,
	slotsLeft,
	limit,
}: {
	uploads: Uploads;
	// Off: chosen files go up at once. On: they wait for a name and email, then "Upload". Kept by the page, so it stays
	// as it was when the drawer opens again.
	withDetails: boolean;
	onWithDetailsChange: (on: boolean) => void;
	note: string | null;
	// What to do about the note: open the job, reopen it, or upgrade.
	noteAction?: ReactNode;
	slotsLeft: number;
	limit: number;
}) {
	const [dragging, setDragging] = useState(false);
	const coarse = useCoarsePointer();
	const inputId = useId();
	const helpId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const noteRef = useRef<HTMLParagraphElement>(null);
	const busy = items.some(isPending);
	const summary = summarise(items);
	const takeFiles = (files: FileList | null) => {
		if (files) choose([...files], slotsLeft, limit, withDetails);
	};
	const staged = items.filter(({ state }) => state === "staged").length;
	// The control that was pressed goes away (the Upload button, a row's Remove, Clear list), so focus moves on to
	// the chooser, or to the note when the job can't take CVs.
	const refocus = () => (inputRef.current ?? noteRef.current)?.focus();

	return (
		<div className="flex flex-col gap-4">
			{!note ? (
				<div
					onDragEnter={(event) => {
						if (hasFiles(event) && !busy) setDragging(true);
					}}
					onDragOver={(event) => {
						// Without this the browser opens the dropped PDF instead of handing it to us.
						if (hasFiles(event)) event.preventDefault();
					}}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
					}}
					onDrop={(event) => {
						if (!hasFiles(event)) return;
						event.preventDefault();
						setDragging(false);
						if (!busy) takeFiles(event.dataTransfer.files);
					}}
					className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors duration-200 ${dragging ? "border-ink bg-marker-soft" : "border-line bg-paper"}`}
				>
					<FileUp size={32} strokeWidth={1.75} aria-hidden="true" className="text-ink" />
					<div>
						<p className="text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
							{dragging ? "Drop to upload" : coarse ? "Add CVs" : "Drop CVs here"}
						</p>
						<p id={helpId} className="mt-1 font-mono text-[12px] text-ink-muted">
							PDF only · up to {CV_MAX_BYTES / (1024 * 1024)} MB each
						</p>
					</div>
					<input
						ref={inputRef}
						id={inputId}
						type="file"
						accept="application/pdf"
						multiple
						aria-describedby={helpId}
						data-autofocus=""
						className="peer sr-only"
						onChange={(event) => {
							takeFiles(event.target.files);
							// So choosing the same file again still counts as a change.
							event.target.value = "";
						}}
					/>
					{/* While files go up the input stays focusable (disabling it would drop keyboard focus); new picks are ignored. */}
					<label
						htmlFor={inputId}
						className={`btn peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${busy ? "pointer-events-none opacity-70" : ""}`}
					>
						Choose PDFs
					</label>
				</div>
			) : (
				<div className="flex flex-col items-start gap-3 rounded-xl border-[1.5px] border-line bg-paper p-5">
					<p ref={noteRef} tabIndex={-1} data-autofocus="" className="text-[15px] text-ink-2 focus:outline-none">
						{note}
					</p>
					{noteAction}
				</div>
			)}

			{!note && (
				<div>
					<Checkbox label="Add a name or email to each CV" checked={withDetails} onCheckedChange={onWithDetailsChange} />
					<p className="ml-[28px] text-[13px] text-ink-muted">Files wait here until you upload them. Blank fields are read from the CV.</p>
				</div>
			)}

			<p role="status" className="flex items-center gap-2.5 border-t border-line-2 pt-4 font-mono text-[13px] text-ink empty:sr-only">
				{busy && <span className="live-dot" aria-hidden="true" />}
				{summary}
			</p>
			{items.length > 0 && (
				<div className="-mt-2">
					<ul className="divide-y divide-line-2">
						{items.map((item) => (
							<li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 font-mono text-[12.5px]">
								<span className="min-w-0 text-ink [overflow-wrap:anywhere]">{item.fileName}</span>
								<UploadState item={item} />
								{/* Only a file that hasn't started can be taken out, and only one that dropped on the way can be sent again. */}
								{(item.state === "staged" || item.state === "waiting") && (
									<button
										type="button"
										className={`ml-auto font-sans ${ROW_ACTION}`}
										aria-label={`Remove ${item.fileName}`}
										onClick={() => {
											remove(item.key);
											refocus();
										}}
									>
										Remove
									</button>
								)}
								{item.state === "failed" && item.canRetry && (
									<button
										type="button"
										className={`ml-auto font-sans ${ROW_ACTION}`}
										aria-label={`Retry upload ${item.fileName}`}
										onClick={() => {
											retry(item.key);
											refocus();
										}}
									>
										Retry upload
									</button>
								)}
								{item.state === "staged" && <DetailFields item={item} onEdit={(change) => edit(item.key, change)} />}
							</li>
						))}
					</ul>
					<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
						{staged > 0 && (
							<button
								type="button"
								className="btn"
								onClick={() => {
									upload();
									refocus();
								}}
							>
								{staged === 1 ? "Upload 1 CV" : `Upload ${staged} CVs`}
							</button>
						)}
						{!busy && (
							<button
								type="button"
								className={ROW_ACTION}
								onClick={() => {
									clear();
									refocus();
								}}
							>
								Clear list
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
