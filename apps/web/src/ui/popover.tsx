import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
	useEffect,
	useEffectEvent,
	useId,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type Align, useAnchor } from "./use-anchor.ts";
import { focusables } from "./use-modal.ts";

export type PopoverTriggerProps = {
	ref: Ref<HTMLButtonElement>;
	type: "button";
	"aria-haspopup": "dialog";
	"aria-expanded": boolean;
	"aria-controls": string | undefined;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

// A small panel attached to a button (design system §4: popover): the share box, a filter with a search field.
// Focus moves into it and Tab cycles inside; Escape or a click outside closes it and Escape returns focus to the
// button. `label` names the panel for screen readers. `children` may be a function that gets `close`.
export function Popover({
	trigger,
	label,
	triggerLabel,
	triggerClassName = "btn ghost",
	children,
	align = "start",
	side = "bottom",
	className = "",
	open: controlled,
	onOpenChange,
}: {
	trigger: ReactNode | ((props: PopoverTriggerProps) => ReactElement);
	label: string;
	// The button's accessible name when its content is only an icon.
	triggerLabel?: string;
	triggerClassName?: string;
	children: ReactNode | ((close: () => void) => ReactNode);
	align?: Align;
	side?: "bottom" | "top";
	// On the panel: a width ("w-[360px]").
	className?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const panelId = useId();
	const [own, setOwn] = useState(false);
	const open = controlled ?? own;
	const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
	const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
	const position = useAnchor(open, triggerEl, panelEl, { side, align });
	const placed = position !== null;

	const change = (next: boolean) => {
		setOwn(next);
		onOpenChange?.(next);
	};
	const close = () => {
		change(false);
		triggerEl?.focus();
	};
	const closeQuietly = useEffectEvent(() => change(false));

	useEffect(() => {
		if (!open || !placed || !panelEl) return;
		(panelEl.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(panelEl)[0] ?? panelEl).focus({ preventScroll: true });
	}, [open, placed, panelEl]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (panelEl?.contains(target) || triggerEl?.contains(target)) return;
			closeQuietly();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, panelEl, triggerEl]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== "Tab") return;
		const items = focusables(event.currentTarget);
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) return event.preventDefault();
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	const triggerProps: PopoverTriggerProps = {
		ref: setTriggerEl,
		type: "button",
		"aria-haspopup": "dialog",
		"aria-expanded": open,
		"aria-controls": open ? panelId : undefined,
		onClick: (event) => {
			event.preventDefault();
			event.stopPropagation();
			change(!open);
		},
	};

	return (
		<>
			{typeof trigger === "function" ? (
				trigger(triggerProps)
			) : (
				<button {...triggerProps} aria-label={triggerLabel} className={triggerClassName}>
					{trigger}
				</button>
			)}
			{open &&
				createPortal(
					<div
						ref={setPanelEl}
						id={panelId}
						role="dialog"
						aria-label={label}
						tabIndex={-1}
						onKeyDown={onKeyDown}
						onClick={(event) => event.stopPropagation()}
						className={`popover-panel layer-popover ${className}`}
						style={
							position
								? { top: position.top, left: position.left, maxHeight: position.maxHeight }
								: { top: 0, left: 0, visibility: "hidden" }
						}
					>
						{typeof children === "function" ? children(close) : children}
					</div>,
					document.body,
				)}
		</>
	);
}
