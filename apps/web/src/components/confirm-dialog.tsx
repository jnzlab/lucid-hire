import { type ReactNode, useRef } from "react";
import { Dialog } from "../ui/dialog.tsx";

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
// a delete, or leaving a form with unsaved changes. Built on the Dialog primitive as an alertdialog: focus starts on
// the cancel button, the safe choice, and stays inside; Escape cancels. While the action runs the buttons only look
// disabled (aria-disabled), so focus stays on the one that was pressed, and Escape does nothing.
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
	const cancelRef = useRef<HTMLButtonElement>(null);
	return (
		<Dialog
			role="alertdialog"
			size="sm"
			title={heading}
			description={children}
			closeButton={false}
			dismissable={!busy}
			initialFocus={cancelRef}
			onClose={onCancel}
			footer={
				<>
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
				</>
			}
		>
			{error && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {error}
				</p>
			)}
		</Dialog>
	);
}
