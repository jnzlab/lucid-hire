import { useRouterState } from "@tanstack/react-router";
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { CV_MAX_BYTES, type UploadItem, type useUploadCvs } from "../lib/candidates.ts";
import { useCoarsePointer } from "../lib/use-coarse-pointer.ts";
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
				className="block h-2 w-24 overflow-hidden rounded-full border border-line bg-paper-2"
			>
				<span className="block h-full bg-ink transition-[width] duration-200" style={{ width: `${percent}%` }} />
			</span>
			<span className="tabular-nums">{percent}%</span>
		</span>
	);
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
	uploads: { items, upload, remove, retry, clear },
	note,
	noteAction,
	slotsLeft,
	limit,
}: {
	uploads: ReturnType<typeof useUploadCvs>;
	note: string | null;
	// What to do about the note, such as upgrading.
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
	// "Upload CVs" in the sidebar arrives with #upload: scroll here and focus the chooser (or the note saying why not).
	const wantsUpload = useRouterState({ select: (state) => state.location.hash === "upload" });
	useEffect(() => {
		if (!wantsUpload) return;
		const target = inputRef.current ?? noteRef.current;
		target?.focus();
		target?.scrollIntoView?.({ block: "center" });
	}, [wantsUpload]);
	const busy = items.some(({ state }) => state === "waiting" || state === "uploading");
	const summary = summarise(items);
	const takeFiles = (files: FileList | null) => {
		if (files) void upload([...files], slotsLeft, limit);
	};
	// The button that was pressed goes away with its row, so focus moves to the next thing that can take it.
	const removeFile = (key: number) => {
		remove(key);
		(inputRef.current ?? noteRef.current)?.focus();
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
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<p ref={noteRef} tabIndex={-1} className="text-[15px] text-ink-2">
						{note}
					</p>
					{noteAction}
				</div>
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
								{/* Only a file that hasn't started can be taken out, and only one that dropped on the way can be sent again. */}
								{item.state === "waiting" && (
									<button
										type="button"
										className={ROW_ACTION}
										aria-label={`Remove ${item.fileName}`}
										onClick={() => removeFile(item.key)}
									>
										Remove
									</button>
								)}
								{item.state === "failed" && item.canRetry && (
									<button
										type="button"
										className={ROW_ACTION}
										aria-label={`Retry upload ${item.fileName}`}
										onClick={() => retry(item.key)}
									>
										Retry upload
									</button>
								)}
							</li>
						))}
					</ul>
					{!busy && (
						<button
							type="button"
							className={`mt-1 ${ROW_ACTION}`}
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
