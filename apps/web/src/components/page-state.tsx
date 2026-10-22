// Full-page states while the session or the account loads, as the status pill (design system §4).
export function PageLoading({ label }: { label: string }) {
	return (
		<div className="grid min-h-dvh place-items-center bg-paper p-4">
			<p
				role="status"
				className="inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card"
			>
				<span className="live-dot" aria-hidden="true" />
				{label}
			</p>
		</div>
	);
}

export function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="grid min-h-dvh place-items-center bg-paper p-4">
			<div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
				<h1 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					<span className="mk mk-gap">✕ We couldn't load your account</span>
				</h1>
				<p className="text-[15px] text-ink-2">{message}</p>
				<button type="button" className="btn" onClick={onRetry}>
					Try again
				</button>
			</div>
		</div>
	);
}
