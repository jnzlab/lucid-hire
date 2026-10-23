import { ExternalLink, FileText } from "lucide-react";
import { formatFileSize } from "../../lib/format.ts";
import type { CvPreview as Preview } from "./use-cv-preview.ts";

export type OpenCv = { open: () => void; isPending: boolean; error: string | null };

// Opens the PDF in a new tab. Only looks disabled while the file loads, so it keeps keyboard focus; open() ignores
// repeat clicks.
export function OpenCvAction({ cv, className = "btn ghost xs", label = "Open CV" }: { cv: OpenCv; className?: string; label?: string }) {
	return (
		<button type="button" className={className} aria-disabled={cv.isPending} onClick={cv.open}>
			<ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
			{cv.isPending ? "Opening" : label}
		</button>
	);
}

// The CV itself, on the desk (design system §3): the PDF in the browser's own viewer on a sheet, with the file's
// name and a way to open it in a new tab under it. Phones and tablets don't show PDFs inside a page, so `inline` is
// off there and the sheet offers Open CV instead. While the file loads, or when it can't, the sheet says so.
export function CvPreview({
	name,
	fileName,
	fileSize,
	preview,
	onRetry,
	cv,
	inline,
	frameClassName,
}: {
	// Whose CV it is, for the frame's title.
	name: string;
	fileName: string;
	fileSize: number;
	preview: Preview;
	onRetry: () => void;
	cv: OpenCv;
	inline: boolean;
	// The frame's height for the pane it is in.
	frameClassName: string;
}) {
	const sheet = "rounded-sheet bg-sheet shadow-sheet";
	const fallback = (title: string, body: string, retry = false) => (
		<div className={`${sheet} flex flex-col items-start gap-4 p-6`}>
			<FileText size={28} strokeWidth={1.5} aria-hidden="true" className="text-ink-muted" />
			<div>
				<p className="text-[17px] leading-[1.25] font-[800] [font-stretch:108%]">{title}</p>
				<p className="mt-1 text-[15px] text-ink-2">{body}</p>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<OpenCvAction cv={cv} className={retry ? "btn ghost" : "btn"} />
				{retry && (
					<button type="button" className="btn" onClick={onRetry}>
						Try again
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="desk rounded-2xl p-3 sm:p-5">
			{!inline ? (
				fallback(fileName, "Open the PDF to read it in your browser's viewer.")
			) : preview.state === "ready" ? (
				<div className={`${sheet} overflow-hidden`}>
					<iframe src={`${preview.url}#view=FitH`} title={`CV of ${name}`} className={`block w-full border-0 ${frameClassName}`} />
				</div>
			) : preview.state === "failed" ? (
				<div role="alert">{fallback("We couldn't show the CV here", "Try again, or open it in a new tab.", true)}</div>
			) : (
				<div className={`${sheet} flex flex-col gap-3 p-6 ${frameClassName}`}>
					<p role="status" className="inline-flex items-center gap-2.5 font-mono text-[13.5px] text-ink">
						<span className="live-dot" aria-hidden="true" />
						Loading the CV
					</p>
					{/* The grey lines of a sheet waiting for its text. */}
					<span aria-hidden="true" className="mt-4 flex flex-col gap-2.5">
						<span className="skeleton h-4 w-1/2" />
						<span className="skeleton h-3 w-1/3" />
						<span className="skeleton mt-4 h-3 w-full" />
						<span className="skeleton h-3 w-11/12" />
						<span className="skeleton h-3 w-4/5" />
					</span>
				</div>
			)}
			<div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<p className="min-w-0 font-mono text-[12.5px] text-ink-muted [overflow-wrap:anywhere]">
					{fileName} · {formatFileSize(fileSize)}
				</p>
				{inline && <OpenCvAction cv={cv} label="Open in a new tab" />}
			</div>
			{cv.error && (
				<p role="alert" className="mt-2 text-[14px] text-gap-ink">
					✕ {cv.error}
				</p>
			)}
		</div>
	);
}
