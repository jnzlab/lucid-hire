// Shown when a refresh failed but there is still something on screen to keep. While CVs are being read the
// page keeps asking by itself; otherwise nothing will, so there is a button.
export function RefreshFailed({ polling, onRetry }: { polling: boolean; onRetry: () => void }) {
	return (
		<p role="status" className="mb-3 flex flex-wrap items-center gap-x-3 font-mono text-[12.5px] text-gap-ink">
			<span>✕ Couldn't refresh.{polling && " Retrying."}</span>
			{!polling && (
				<button
					type="button"
					className="min-h-11 rounded-[3px] px-1 font-sans text-[14px] font-semibold text-ink underline underline-offset-[.18em]"
					onClick={onRetry}
				>
					Try again
				</button>
			)}
		</p>
	);
}
