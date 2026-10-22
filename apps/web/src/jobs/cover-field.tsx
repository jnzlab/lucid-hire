import { useId, useRef, useState } from "react";
import { type Job, checkCover, useCoverImage, useRemoveCover, useSetCover } from "../lib/jobs.ts";

// The optional cover image on the edit page. It saves on its own as soon as a file is chosen or removed, so it
// doesn't wait for "Save changes" (and doesn't count as an unsaved change in the form).
export function CoverField({ job }: { job: Job }) {
	const inputId = useId();
	const helpId = useId();
	const set = useSetCover(job.id);
	const remove = useRemoveCover(job.id);
	const image = useCoverImage(job.id, job.hasCover, job.updatedAt);
	const [problem, setProblem] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const busy = set.isPending || remove.isPending;
	const error = problem ?? (set.isError ? set.error.message : remove.isError ? remove.error.message : null);

	const choose = (file: File | undefined) => {
		if (!file || busy) return;
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
		<section aria-labelledby="cover-h" className="max-w-[760px] rounded-xl bg-sheet p-6 shadow-card min-[561px]:p-8">
			<h2 id="cover-h" className="text-[14px] font-semibold text-ink">
				Cover image
			</h2>
			<p id={helpId} className="mt-1 text-[13px] text-ink-muted">
				Optional. Shown at the top of the public page and in link previews. JPEG, PNG or WebP, up to 2 MB.
			</p>
			{job.hasCover && image.data && (
				<img src={image.data} alt="Current cover" className="mt-4 h-[clamp(120px,22vw,200px)] w-full rounded-lg object-cover" />
			)}
			<div className="mt-4 flex flex-wrap items-center gap-3">
				<input
					ref={inputRef}
					id={inputId}
					type="file"
					accept="image/jpeg,image/png,image/webp"
					aria-describedby={helpId}
					className="peer sr-only"
					onChange={(event) => {
						choose(event.target.files?.[0]);
						event.target.value = "";
					}}
				/>
				<label
					htmlFor={inputId}
					className={`btn ghost peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${busy ? "pointer-events-none opacity-70" : ""}`}
				>
					{set.isPending ? "Uploading" : job.hasCover ? "Replace image" : "Choose an image"}
				</label>
				{job.hasCover && (
					<button type="button" className="btn danger" aria-disabled={busy} onClick={clear}>
						{remove.isPending ? "Removing" : "Remove image"}
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
		</section>
	);
}
