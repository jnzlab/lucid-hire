import { useOpenCv } from "../lib/candidates.ts";

type OpenCvButtonProps = { jobId: string; candidateId: string; fileName: string };

// Opens the original PDF in a new tab. If that fails the message sits under the button.
export function OpenCvButton({ jobId, candidateId, fileName }: OpenCvButtonProps) {
	const cv = useOpenCv(jobId, candidateId, fileName);
	return (
		<>
			{/* Only looks disabled while the file loads, so it keeps keyboard focus; open() ignores repeat clicks. */}
			<button type="button" className="btn ghost aria-disabled:cursor-progress aria-disabled:opacity-70" aria-disabled={cv.isPending} onClick={cv.open}>
				{cv.isPending ? "Opening" : "Open CV"}
			</button>
			{cv.error && (
				<p role="alert" className="basis-full text-[14px] text-gap-ink">
					✕ {cv.error}
				</p>
			)}
		</>
	);
}
