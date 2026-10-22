import { type ReactNode, useEffect, useEffectEvent, useId, useRef } from "react";

type ConfirmDialogProps = {
	heading: string;
	// What happens and to whom. For a delete, it ends with "You can't undo this."
	children: ReactNode;
	confirmLabel: string;
	// The way out that changes nothing. Focus starts on it.
	cancelLabel?: string;
	// The confirm button's label while the action is running.
	busyLabel?: string;
	busy?: boolean;
	error?: string | null;
	onCancel: () => void;
	onConfirm: () => void;
};

// Confirms a choice that can't be taken back (design system §4: destructive actions always confirm in a dialog):
// a delete, or leaving a form with unsaved changes. Focus starts on the cancel button, the safe choice, and stays
// inside the dialog. Escape cancels. While the action runs the buttons only look disabled (aria-disabled), so
// focus stays on the one that was pressed.
export function ConfirmDialog({
	heading,
	children,
	confirmLabel,
	cancelLabel = "Cancel",
	busyLabel = confirmLabel,
	busy = false,
	error = null,
	onCancel,
	onConfirm,
}: ConfirmDialogProps) {
	const headingId = useId();
	const bodyId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const onKey = useEffectEvent((event: KeyboardEvent) => {
		if (event.key === "Escape" && !busy) onCancel();
		if (event.key !== "Tab" || !dialogRef.current) return;

		// Tab and Shift+Tab wrap around the dialog's buttons instead of leaving it.
		const buttons = [...dialogRef.current.querySelectorAll<HTMLButtonElement>("button")];
		const first = buttons[0];
		const last = buttons[buttons.length - 1];
		const inside = dialogRef.current.contains(document.activeElement);
		if (!first || !last) event.preventDefault();
		else if (!inside || (event.shiftKey && document.activeElement === first)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
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
				ref={dialogRef}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={headingId}
				aria-describedby={bodyId}
				className="w-full max-w-[440px] rounded-xl bg-sheet p-6 shadow-float min-[561px]:p-8"
			>
				<h2
					id={headingId}
					className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%]"
				>
					{heading}
				</h2>
				<p id={bodyId} className="mt-3 text-[15px] text-ink-2">
					{children}
				</p>
				{error && (
					<p role="alert" className="mt-4 text-[14px] text-gap-ink">
						✕ {error}
					</p>
				)}
				<div className="mt-6 flex flex-wrap justify-end gap-3">
					<button
						ref={cancelRef}
						type="button"
						className="btn ghost"
						aria-disabled={busy}
						onClick={() => {
							if (!busy) onCancel();
						}}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						className="btn danger"
						aria-disabled={busy}
						onClick={() => {
							if (!busy) onConfirm();
						}}
					>
						{busy ? busyLabel : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
