import { useEffect, useEffectEvent, useId, useRef } from "react";

type DeleteJobDialogProps = {
	title: string;
	companyName: string;
	deleting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: () => void;
};

// Confirms a delete (design system §4: destructive actions always confirm in a dialog). Focus starts on
// Cancel, the safe choice, and Escape closes it.
export function DeleteJobDialog({ title, companyName, deleting, error, onCancel, onConfirm }: DeleteJobDialogProps) {
	const headingId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const onKey = useEffectEvent((event: KeyboardEvent) => {
		if (event.key === "Escape" && !deleting) onCancel();
	});

	// Runs once while the dialog is open, then gives focus back to the button that opened it.
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		cancelRef.current?.focus();
		const listener = (event: KeyboardEvent) => onKey(event);
		document.addEventListener("keydown", listener);
		return () => {
			document.removeEventListener("keydown", listener);
			opener?.focus();
		};
	}, []);

	return (
		<div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(20,20,20,.5)] p-4">
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={headingId}
				className="w-full max-w-[440px] rounded-xl bg-sheet p-6 shadow-float min-[561px]:p-8"
			>
				<h2 id={headingId} className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Delete “{title}”?
				</h2>
				<p className="mt-3 text-[15px] text-ink-2">
					It's removed for everyone at {companyName}. You can't undo this.
				</p>
				{error && (
					<p role="alert" className="mt-4 text-[14px] text-gap-ink">
						✕ {error}
					</p>
				)}
				<div className="mt-6 flex flex-wrap justify-end gap-3">
					<button ref={cancelRef} type="button" className="btn ghost" onClick={onCancel} disabled={deleting}>
						Cancel
					</button>
					<button type="button" className="btn danger" onClick={onConfirm} disabled={deleting}>
						{deleting ? "Deleting" : "Delete job"}
					</button>
				</div>
			</div>
		</div>
	);
}
