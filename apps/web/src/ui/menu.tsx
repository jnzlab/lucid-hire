import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
	createContext,
	use,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "../components/icons.tsx";
import { AppLink } from "./app-link.tsx";
import { Shortcut } from "./kbd.tsx";
import { type Align, useAnchor } from "./use-anchor.ts";

export type MenuTriggerProps = {
	ref: Ref<HTMLButtonElement>;
	id: string;
	type: "button";
	"aria-haspopup": "menu";
	"aria-expanded": boolean;
	"aria-controls": string | undefined;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

type MenuContextValue = { close: (focusTrigger?: boolean) => void };
const MenuContext = createContext<MenuContextValue | null>(null);

const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';
const TYPEAHEAD_MS = 500;
const itemsIn = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>(ITEM) ?? [])];

// A button that opens a list of actions (design system §4: menu). Arrow keys, Home and End move through the items,
// typing a letter jumps to the next item starting with it, Enter or Space runs one, Escape or Tab closes it and
// focus goes back to the button. A click outside closes it too.
//
//   <Menu label="Actions for Backend Engineer" trigger={<MoreHorizontal size={20} />} triggerClassName="icon-btn">
//     <MenuItem href="/dashboard/jobs/j1/edit" icon={<Pencil size={16} />}>Edit job</MenuItem>
//     <MenuItem onSelect={duplicate}>Duplicate</MenuItem>
//     <MenuSeparator />
//     <MenuItem destructive onSelect={askToDelete}>Delete job</MenuItem>
//   </Menu>
//
// `trigger` is the button's content, or a function that renders the whole button from the props it is given (to
// use a StatusTag or an IconButton as the trigger). Nested choices go in a labelled `MenuGroup`.
export function Menu({
	trigger,
	label,
	triggerClassName = "btn ghost",
	children,
	align = "start",
	side = "bottom",
	className = "",
	onOpenChange,
}: {
	trigger: ReactNode | ((props: MenuTriggerProps) => ReactElement);
	// The button's accessible name when its content is only an icon.
	label?: string;
	triggerClassName?: string;
	children: ReactNode;
	align?: Align;
	side?: "bottom" | "top";
	// On the list: a width ("w-64").
	className?: string;
	onOpenChange?: (open: boolean) => void;
}) {
	const triggerId = useId();
	const menuId = useId();
	const [open, setOpen] = useState(false);
	// Which item takes focus when the list opens.
	const [start, setStart] = useState<"first" | "last">("first");
	// Elements in state rather than refs: the list is placed from them, and render-prop triggers receive the setter.
	const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
	const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);
	const typed = useRef({ text: "", at: 0 });
	const position = useAnchor(open, triggerEl, menuEl, { side, align });

	const change = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};
	const close = (focusTrigger = true) => {
		change(false);
		if (focusTrigger) triggerEl?.focus();
	};
	const openAt = (where: "first" | "last") => {
		setStart(where);
		change(true);
	};

	const placed = position !== null;

	// Focus the first (or last) item once the list is in the page and placed.
	useEffect(() => {
		if (!open || !placed) return;
		const list = itemsIn(menuEl);
		(start === "last" ? list[list.length - 1] : list[0])?.focus({ preventScroll: true });
	}, [open, placed, start, menuEl]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (menuEl?.contains(target) || triggerEl?.contains(target)) return;
			setOpen(false);
			onOpenChange?.(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, onOpenChange, menuEl, triggerEl]);

	const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const list = itemsIn(event.currentTarget);
		const index = list.indexOf(document.activeElement as HTMLElement);
		const focusAt = (next: number) => list[(next + list.length) % list.length]?.focus();
		switch (event.key) {
			case "ArrowDown":
				focusAt(index + 1);
				break;
			case "ArrowUp":
				focusAt(index < 0 ? list.length - 1 : index - 1);
				break;
			case "Home":
				focusAt(0);
				break;
			case "End":
				focusAt(list.length - 1);
				break;
			case "Escape":
			case "Tab":
				close();
				break;
			case "Enter":
			case " ":
				(document.activeElement as HTMLElement | null)?.click();
				break;
			default: {
				if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
				const now = event.timeStamp;
				typed.current = { text: (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + event.key.toLowerCase(), at: now };
				const text = typed.current.text;
				// From the item after the focused one, so typing the same letter again moves on to the next match.
				const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
				const repeat = text.length > 1 && [...text].every((char) => char === text[0]);
				const match = ordered.find((item) => (item.textContent ?? "").trim().toLowerCase().startsWith(repeat ? text[0] : text));
				match?.focus();
				break;
			}
		}
		event.preventDefault();
		event.stopPropagation();
	};

	const triggerProps: MenuTriggerProps = {
		ref: setTriggerEl,
		id: triggerId,
		type: "button",
		"aria-haspopup": "menu",
		"aria-expanded": open,
		"aria-controls": open ? menuId : undefined,
		onClick: (event) => {
			// A menu in a clickable row doesn't also open the row.
			event.preventDefault();
			event.stopPropagation();
			if (open) close(false);
			else openAt("first");
		},
		onKeyDown: (event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				openAt(event.key === "ArrowUp" ? "last" : "first");
			}
		},
	};

	return (
		<>
			{typeof trigger === "function" ? (
				trigger(triggerProps)
			) : (
				<button {...triggerProps} aria-label={label} className={triggerClassName}>
					{trigger}
				</button>
			)}
			{open &&
				createPortal(
					<MenuContext value={{ close }}>
						<div
							ref={setMenuEl}
							id={menuId}
							role="menu"
							aria-labelledby={triggerId}
							tabIndex={-1}
							onKeyDown={onMenuKeyDown}
							// Keep clicks inside from reaching a row link under the menu's React parent.
							onClick={(event) => event.stopPropagation()}
							className={`menu-panel layer-popover ${className}`}
							style={
								position
									? { top: position.top, left: position.left, maxHeight: position.maxHeight }
									: { top: 0, left: 0, visibility: "hidden" }
							}
						>
							{children}
						</div>
					</MenuContext>,
					document.body,
				)}
		</>
	);
}

// One action in a Menu: a button (`onSelect`) or a link (`href`; app paths navigate in the app, anything else
// opens normally). `checked` makes it a radio item (a sort order), drawn with a check. `description` is a second
// line in mono for what the action does. `destructive` is gap-ink text, for deletes (confirm them in a dialog).
export function MenuItem({
	children,
	onSelect,
	href,
	target,
	icon,
	shortcut,
	description,
	destructive = false,
	disabled = false,
	checked,
	closeOnSelect = true,
	className = "",
}: {
	children: ReactNode;
	onSelect?: () => void;
	href?: string;
	target?: string;
	icon?: ReactNode;
	// A hotkey spec shown on the right ("e").
	shortcut?: string;
	description?: ReactNode;
	destructive?: boolean;
	disabled?: boolean;
	checked?: boolean;
	closeOnSelect?: boolean;
	className?: string;
}) {
	const menu = use(MenuContext);
	const role = checked === undefined ? "menuitem" : "menuitemradio";
	const look = `menu-item ${destructive ? "is-destructive" : ""} ${className}`;
	const select = (event: MouseEvent<HTMLElement>) => {
		if (disabled) {
			event.preventDefault();
			return;
		}
		onSelect?.();
		if (closeOnSelect) menu?.close(!href);
	};
	const content = (
		<>
			{checked !== undefined ? (
				<span className="grid size-4 flex-none place-items-center">{checked && <Check />}</span>
			) : (
				icon && <span className="grid size-4 flex-none place-items-center [&>svg]:size-4">{icon}</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate">{children}</span>
				{description && <span className="font-mono text-[12px] leading-[1.35] font-normal whitespace-normal text-ink-muted">{description}</span>}
			</span>
			{shortcut && <Shortcut keys={shortcut} className="ml-3" />}
		</>
	);
	const shared = {
		role,
		tabIndex: -1,
		"aria-disabled": disabled || undefined,
		"aria-checked": checked,
		className: look,
		onClick: select,
	} as const;

	if (href && !disabled) {
		if (href.startsWith("/") && !target) {
			return (
				<AppLink href={href} {...shared}>
					{content}
				</AppLink>
			);
		}
		return (
			<a href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} {...shared}>
				{content}
			</a>
		);
	}
	return (
		<button type="button" {...shared}>
			{content}
		</button>
	);
}

// A thin rule between groups of items.
export function MenuSeparator() {
	return <div role="separator" className="menu-sep" />;
}

// Items under a small mono heading: "Export CSV" › All, Shortlisted, To review, Not a fit.
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
	const id = useId();
	return (
		<div role="group" aria-labelledby={id}>
			<div id={id} className="menu-label">
				{label}
			</div>
			{children}
		</div>
	);
}
