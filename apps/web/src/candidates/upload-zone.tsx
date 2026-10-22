import { type DragEvent, useId, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { CV_MAX_BYTES, type UploadItem, type useUploadCvs } from "../lib/candidates.ts";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

// What to say about a file while it goes up, and after.
function UploadState({ item }: { item: UploadItem }) {
	if (item.state === "failed") return <span className="text-gap-ink">✕ {item.error}</span>;
	if (item.state === "done")
		return (
			<span className="inline-flex items-center gap-1.5 text-ink">
				<Check /> Uploaded
			</span>
		);
	return <span className="text-ink-muted">{item.state === "uploading" ? "Uploading" : "Waiting"}</span>;
}

// The tally read out to screen readers: the file list below it is for the eyes.
function summarise(items: UploadItem[]) {
	const pending = items.filter(({ state }) => state === "waiting" || state === "uploading").length;
	if (pending > 0) return `Uploading ${pending} ${pending === 1 ? "file" : "files"}`;
	const failed = items.filter(({ state }) => state === "failed").length;
	const done = items.length - failed;
	if (items.length === 0) return null;
	if (failed === 0) return `${done} ${done === 1 ? "CV" : "CVs"} uploaded`;
	return done === 0 ? `${failed} not uploaded` : `${done} uploaded · ${failed} not uploaded`;
}

// Drop PDFs on the zone or pick them with the button. Files go up one after another; each one's
// result, or the reason it was refused, is listed under the zone. When the job can't take CVs the
// `note` says why and takes the place of the chooser, but the results of the last batch stay.
export function UploadZone({
	uploads: { items, upload, clear },
	note,
	slotsLeft,
}: {
	uploads: ReturnType<typeof useUploadCvs>;
	note: string | null;
	slotsLeft: number;
}) {
	const [dragging, setDragging] = useState(false);
	const inputId = useId();
	const helpId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const noteRef = useRef<HTMLParagraphElement>(null);
	const busy = items.some(({ state }) => state === "waiting" || state === "uploading");
	const summary = summarise(items);
	const takeFiles = (files: FileList | null) => {
		if (files) void upload([...files], slotsLeft);
	};
	// "Clear list" goes away with the list, so focus moves on to the chooser (or, when the job can't take CVs, its note).
	const clearList = () => {
		clear();
		(inputRef.current ?? noteRef.current)?.focus();
	};

	return (
		<div
			onDragEnter={(event) => {
				if (hasFiles(event) && !busy && !note) setDragging(true);
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
				if (!busy && !note) takeFiles(event.dataTransfer.files);
			}}
			className={`rounded-xl border-[1.5px] border-dashed p-6 transition-colors duration-200 ${dragging ? "border-ink bg-marker-soft" : "border-line bg-sheet"}`}
		>
			{!note ? (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
					<div className="min-w-0">
						<p className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
							{dragging ? "Drop to upload" : "Drop CVs here"}
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
						className="peer sr-only"
						onChange={(event) => {
							takeFiles(event.target.files);
							// So choosing the same file again still counts as a change.
							event.target.value = "";
						}}
					/>
					<label
						htmlFor={inputId}
						className={`btn ghost peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${busy ? "pointer-events-none opacity-70" : ""}`}
					>
						Choose PDFs
					</label>
				</div>
			) : (
				<p ref={noteRef} tabIndex={-1} className="text-[15px] text-ink-2">
					{note}
				</p>
			)}

			<p
				role="status"
				className="mt-4 flex items-center gap-2.5 border-t border-line-2 pt-4 font-mono text-[13px] text-ink empty:hidden"
			>
				{busy && <span className="live-dot" aria-hidden="true" />}
				{summary}
			</p>
			{items.length > 0 && (
				<>
					<ul>
						{items.map((item) => (
							<li
								key={item.key}
								className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 font-mono text-[12.5px]"
							>
								<span className="min-w-0 text-ink [overflow-wrap:anywhere]">{item.fileName}</span>
								<UploadState item={item} />
							</li>
						))}
					</ul>
					{!busy && (
						<button
							type="button"
							className="mt-1 min-h-11 rounded-[3px] px-1 text-[14px] font-semibold underline underline-offset-[.18em]"
							onClick={clearList}
						>
							Clear list
						</button>
					)}
				</>
			)}
		</div>
	);
}
