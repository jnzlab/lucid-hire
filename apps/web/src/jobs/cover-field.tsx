import { ImageUp } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { type Job, checkCover, useCoverImage, useRemoveCover, useSetCover } from "../lib/jobs.ts";

const HELP = "Optional. Shown at the top of the public page and in link previews. JPEG, PNG or WebP, up to 2 MB.";

// The optional cover image, under the description on the edit page. It saves on its own as soon as a file is chosen
// or removed, so it doesn't wait for "Save changes" (and doesn't count as an unsaved change in the form).
export function CoverField({ job }: { job: Job }) {
	const set = useSetCover(job.id);
	const remove = useRemoveCover(job.id);
	const image = useCoverImage(job.id, job.hasCover, job.updatedAt);
	const [problem, setProblem] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const busy = set.isPending || remove.isPending;
	const error = problem ?? (set.isError ? set.error.message : remove.isError ? remove.error.message : null);

	const choose = (file: File) => {
		if (busy) return;
		const found = checkCover(file);
		setProblem(found);
		setAnnouncement("");
		if (found) return;
		remove.reset();
		set.mutate(file, { onSuccess: () => setAnnouncement("Cover image saved") });
	};

	const clear = () => {
		if (busy) return;
		setProblem(null);
		setAnnouncement("");
		set.reset();
		remove.mutate(undefined, {
			onSuccess: () => {
				setAnnouncement("Cover image removed");
				inputRef.current?.focus();
			},
		});
	};

	return (
		<CoverLayout
			src={job.hasCover ? (image.data ?? null) : null}
			help={HELP}
			inputRef={inputRef}
			busy={busy}
			chooseLabel={set.isPending ? "Uploading" : job.hasCover ? "Replace image" : "Choose an image"}
			onChoose={choose}
			removeLabel={job.hasCover ? (remove.isPending ? "Removing" : "Remove image") : null}
			onRemove={clear}
			announcement={announcement}
			error={error}
		/>
	);
}

// The cover on the new-job page. There's no job to attach it to yet, so the chosen file waits here, checked and
// previewed, and the page uploads it once the job is saved.
export function StagedCoverField({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
	const [problem, setProblem] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	// The preview is made when the file is chosen; each one is let go once it's replaced, removed or the page closes.
	const [src, setSrc] = useState<string | null>(null);
	useEffect(
		() => () => {
			if (src) URL.revokeObjectURL(src);
		},
		[src],
	);

	const choose = (chosen: File) => {
		const found = checkCover(chosen);
		setProblem(found);
		setAnnouncement("");
		if (found) return;
		onChange(chosen);
		setSrc(URL.createObjectURL(chosen));
		setAnnouncement("Cover image added. It uploads when you save the job.");
	};

	const clear = () => {
		setProblem(null);
		onChange(null);
		setSrc(null);
		setAnnouncement("Cover image removed");
		inputRef.current?.focus();
	};

	return (
		<CoverLayout
			src={src}
			help={`${HELP} It uploads when you save the job.`}
			inputRef={inputRef}
			busy={false}
			chooseLabel={file ? "Replace image" : "Choose an image"}
			onChoose={choose}
			removeLabel={file ? "Remove image" : null}
			onRemove={clear}
			announcement={announcement}
			error={problem}
		/>
	);
}

function CoverLayout({
	src,
	help,
	inputRef,
	busy,
	chooseLabel,
	onChoose,
	removeLabel,
	onRemove,
	announcement,
	error,
}: {
	src: string | null;
	help: ReactNode;
	inputRef: RefObject<HTMLInputElement | null>;
	busy: boolean;
	chooseLabel: string;
	onChoose: (file: File) => void;
	// Null hides the remove button (there's nothing to remove).
	removeLabel: string | null;
	onRemove: () => void;
	announcement: string;
	error: string | null;
}) {
	const inputId = useId();
	const helpId = useId();
	return (
		<section aria-labelledby="cover-h" className="flex flex-col gap-4 min-[561px]:flex-row min-[561px]:items-start">
			<div className={`grid aspect-[16/9] w-full flex-none place-items-center overflow-hidden rounded-lg min-[561px]:w-44 ${src ? "" : "desk"}`}>
				{src ? (
					<img src={src} alt="Current cover" className="size-full object-cover" />
				) : (
					<ImageUp size={20} strokeWidth={2} aria-hidden="true" className="text-ink-faint" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<h2 id="cover-h" className="text-[14px] font-semibold text-ink">
					Cover image
				</h2>
				<p id={helpId} className="mt-1 text-[13px] text-ink-muted">
					{help}
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-3">
					<input
						ref={inputRef}
						id={inputId}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						aria-describedby={helpId}
						className="peer sr-only"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) onChoose(file);
							event.target.value = "";
						}}
					/>
					<label
						htmlFor={inputId}
						className={`btn ghost xs peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${busy ? "pointer-events-none opacity-70" : ""}`}
					>
						{chooseLabel}
					</label>
					{removeLabel && (
						<button type="button" className="btn danger xs" aria-disabled={busy} onClick={onRemove}>
							{removeLabel}
						</button>
					)}
				</div>
				<p aria-live="polite" className="mt-3 font-mono text-[12.5px] text-ink empty:hidden">
					{announcement}
				</p>
				{error && (
					<p role="alert" className="mt-3 text-[13px] text-gap-ink">
						✕ {error}
					</p>
				)}
			</div>
		</section>
	);
}
