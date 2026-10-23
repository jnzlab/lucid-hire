import { type RefObject, useEffect, useEffectEvent } from "react";

// Shared by Dialog and Drawer: while open, focus moves inside, Tab and Shift+Tab stay inside, Escape closes, the page
// behind doesn't scroll, and when it closes focus goes back to whatever opened it. Only the topmost open layer
// answers keys, so a confirm dialog opened from a drawer closes on its own.

const FOCUSABLE =
	'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest("[hidden],[inert]"));
}

const stack: object[] = [];
let locks = 0;
let saved = { overflow: "", paddingRight: "" };

function lockScroll() {
	if (locks++ > 0) return;
	const body = document.body;
	saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
	// Keep the page from shifting sideways when its scrollbar goes away.
	const scrollbar = window.innerWidth - document.documentElement.clientWidth;
	body.style.overflow = "hidden";
	if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
	if (--locks > 0) return;
	document.body.style.overflow = saved.overflow;
	document.body.style.paddingRight = saved.paddingRight;
}

export type ModalOptions = {
	open: boolean;
	onClose: () => void;
	// False while something is running that Escape must not interrupt.
	dismissable?: boolean;
	// Where focus starts. Otherwise the first element with data-autofocus, else the first focusable one (not the close
	// button), else the panel.
	initialFocus?: RefObject<HTMLElement | null>;
	// Where focus goes on close when the opener is gone (a deleted row, say).
	returnFocus?: () => HTMLElement | null;
};

export function useModal(panelRef: RefObject<HTMLElement | null>, { open, onClose, dismissable = true, initialFocus, returnFocus }: ModalOptions) {
	const onKey = useEffectEvent((event: KeyboardEvent) => {
		const panel = panelRef.current;
		if (event.defaultPrevented || !panel) return;
		if (event.key === "Escape") {
			event.preventDefault();
			if (dismissable) onClose();
			return;
		}
		if (event.key !== "Tab") return;
		const items = focusables(panel);
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) {
			event.preventDefault();
			panel.focus();
			return;
		}
		const inside = panel.contains(document.activeElement);
		if (!inside || (event.shiftKey && (document.activeElement === first || document.activeElement === panel))) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});
	const findReturn = useEffectEvent(() => returnFocus?.() ?? null);
	const focusStart = useEffectEvent(() => {
		const panel = panelRef.current;
		if (!panel) return;
		// The close button is never the first stop: with nothing else to focus, the panel itself takes focus.
		const target =
			initialFocus?.current ??
			panel.querySelector<HTMLElement>("[data-autofocus]") ??
			focusables(panel).find((element) => !element.hasAttribute("data-close")) ??
			panel;
		target.focus({ preventScroll: true });
	});

	useEffect(() => {
		if (!open) return;
		const token = {};
		stack.push(token);
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		focusStart();
		lockScroll();
		const listener = (event: KeyboardEvent) => {
			if (stack[stack.length - 1] === token) onKey(event);
		};
		document.addEventListener("keydown", listener);
		return () => {
			document.removeEventListener("keydown", listener);
			stack.splice(stack.indexOf(token), 1);
			unlockScroll();
			const back = opener?.isConnected ? opener : findReturn();
			back?.focus({ preventScroll: true });
		};
	}, [open]);
}
