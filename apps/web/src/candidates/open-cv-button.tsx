import { useOpenCv } from "../lib/candidates.ts";
import { ROW_ACTION } from "./row-action.ts";

type OpenCvButtonProps = {
	jobId: string;
	candidateId: string;
	fileName: string;
	// In a list: a text button, named for its candidate so each one is told apart.
	forName?: string;
};

// Opens the original PDF in a new tab. If that fails the message sits under the button.
export function OpenCvButton({ jobId, candidateId, fileName, forName }: OpenCvButtonProps) {
	const cv = useOpenCv(jobId, candidateId, fileName);
	return (
		<>
			{/* Only looks disabled while the file loads, so it keeps keyboard focus; open() ignores repeat clicks. */}
			<button
				type="button"
				className={forName ? ROW_ACTION : "btn ghost"}
				aria-label={forName ? `Open CV for ${forName}` : undefined}
				aria-disabled={cv.isPending}
				onClick={cv.open}
			>
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
