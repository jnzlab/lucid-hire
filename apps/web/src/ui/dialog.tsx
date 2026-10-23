import { X } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./icon-button.tsx";
import { useModal } from "./use-modal.ts";

const WIDTH = {
	sm: "w-[min(440px,100vw_-_32px)]",
	md: "w-[min(560px,100vw_-_32px)]",
	lg: "w-[min(640px,100vw_-_32px)]",
	xl: "w-[min(800px,100vw_-_32px)]",
};

// A modal dialog (design system §4): a sheet card on a dimmed page. Focus moves in and stays in, Escape or a click on
// the dimmed page closes it, and focus goes back to the opener. Give it a visible `title`, or a `label` when the
// content names itself (the command palette). `description` is read out with the title.
export function Dialog({
	open = true,
	onClose,
	title,
	label,
	description,
	children,
	footer,
	role = "dialog",
	size = "md",
	placement = "center",
	dismissable = true,
	closeButton = true,
	padded = true,
	initialFocus,
	returnFocus,
	className = "",
}: {
	open?: boolean;
	onClose: () => void;
	title?: ReactNode;
	label?: string;
	description?: ReactNode;
	children?: ReactNode;
	// Buttons at the bottom, right-aligned and wrapping.
	footer?: ReactNode;
	// `alertdialog` for a confirmation that interrupts.
	role?: "dialog" | "alertdialog";
	size?: keyof typeof WIDTH;
	// `top` sits 12vh from the top, for the command palette.
	placement?: "center" | "top";
	// False while something runs that must not be interrupted: Escape and the dimmed page do nothing.
	dismissable?: boolean;
	closeButton?: boolean;
	// False when the content brings its own padding.
	padded?: boolean;
	initialFocus?: RefObject<HTMLElement | null>;
	returnFocus?: () => HTMLElement | null;
	className?: string;
}) {
	const titleId = useId();
	const descriptionId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const pressedBackdrop = useRef(false);
	useModal(panelRef, { open, onClose, dismissable, initialFocus, returnFocus });
	if (!open) return null;

	return createPortal(
		<div
			className={`layer-modal fixed inset-0 flex justify-center overflow-y-auto bg-overlay p-4 ${placement === "top" ? "items-start pt-[12vh]" : "items-center"}`}
			onMouseDown={(event) => {
				pressedBackdrop.current = event.target === event.currentTarget;
			}}
			onClick={(event) => {
				// Only a click that started and ended on the dimmed page, so dragging out of a field doesn't close it.
				if (event.target === event.currentTarget && pressedBackdrop.current && dismissable) onClose();
				pressedBackdrop.current = false;
			}}
		>
			<div
				ref={panelRef}
				role={role}
				aria-modal="true"
				aria-labelledby={title ? titleId : undefined}
				aria-label={title ? undefined : label}
				aria-describedby={description ? descriptionId : undefined}
				tabIndex={-1}
				className={`dialog-panel relative ${WIDTH[size]} ${padded ? "p-6 min-[561px]:p-8" : ""} ${className}`}
			>
				{title && (
					<h2
						id={titleId}
						className={`text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%] ${closeButton ? "pr-12" : ""}`}
					>
						{title}
					</h2>
				)}
				{description && (
					<p id={descriptionId} className={`text-[15px] text-ink-2 ${title ? "mt-3" : ""}`}>
						{description}
					</p>
				)}
				{children}
				{footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
				{closeButton && (
					<IconButton
						data-close=""
						label="Close"
						tooltip={false}
						icon={<X size={20} strokeWidth={2} aria-hidden="true" />}
						onClick={onClose}
						className="absolute top-3 right-3"
					/>
				)}
			</div>
		</div>,
		document.body,
	);
}
