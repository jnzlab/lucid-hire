import { X } from "lucide-react";
import { type CSSProperties, type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./icon-button.tsx";
import { useModal } from "./use-modal.ts";

// A sheet that slides in from the side (`right` or `left`) on wide screens and up from the bottom below 768px, or
// from the bottom everywhere (`bottom`). Same focus rules as Dialog: focus moves in and stays in, Escape or a tap
// on the dimmed page closes it, focus goes back to the opener. The body scrolls; the header and footer stay.
export function Drawer({
	open = true,
	onClose,
	title,
	label,
	description,
	children,
	footer,
	side = "right",
	width = 480,
	dismissable = true,
	initialFocus,
	returnFocus,
	className = "",
	bodyClassName = "",
}: {
	open?: boolean;
	onClose: () => void;
	title?: ReactNode;
	// The accessible name when there's no title.
	label?: string;
	description?: ReactNode;
	children?: ReactNode;
	footer?: ReactNode;
	side?: "right" | "left" | "bottom";
	// Side sheets only, in px, capped at the window width less 32px.
	width?: number;
	dismissable?: boolean;
	initialFocus?: RefObject<HTMLElement | null>;
	returnFocus?: () => HTMLElement | null;
	className?: string;
	bodyClassName?: string;
}) {
	const titleId = useId();
	const descriptionId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	useModal(panelRef, { open, onClose, dismissable, initialFocus, returnFocus });
	if (!open) return null;

	return createPortal(
		<div className="layer-modal fixed inset-0">
			<div className="absolute inset-0 bg-overlay" aria-hidden="true" onClick={dismissable ? onClose : undefined} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={title ? titleId : undefined}
				aria-label={title ? undefined : label}
				aria-describedby={description ? descriptionId : undefined}
				tabIndex={-1}
				data-side={side}
				style={{ "--drawer-w": `${width}px` } as CSSProperties}
				className={`drawer-panel ${className}`}
			>
				{side === "bottom" && <span className="drawer-grip" aria-hidden="true" />}
				<div className="flex min-h-16 flex-none items-center justify-between gap-3 border-b border-line-2 px-5">
					{title ? (
						<h2 id={titleId} className="min-w-0 text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [overflow-wrap:anywhere] [font-stretch:108%]">
							{title}
						</h2>
					) : (
						<span />
					)}
					<IconButton data-close="" label="Close" tooltip={false} icon={<X size={20} strokeWidth={2} aria-hidden="true" />} onClick={onClose} className="-mr-2" />
				</div>
				{description && (
					<p id={descriptionId} className="px-5 pt-4 text-[15px] text-ink-2">
						{description}
					</p>
				)}
				<div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 ${bodyClassName}`}>{children}</div>
				{footer && <div className="flex flex-none flex-wrap justify-end gap-3 border-t border-line-2 px-5 py-4">{footer}</div>}
			</div>
		</div>,
		document.body,
	);
}
