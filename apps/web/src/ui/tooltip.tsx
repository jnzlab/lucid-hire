import {
	type FocusEvent,
	type PointerEvent,
	type ReactElement,
	type ReactNode,
	cloneElement,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

export type Side = "top" | "right" | "bottom" | "left";

type TriggerProps = { "aria-describedby"?: string };

export const TOOLTIP_DELAY_MS = 400;
const GAP = 8;
const EDGE = 8;

// Places the tip beside the trigger, kept inside the window.
function place(trigger: DOMRect, tip: DOMRect, side: Side) {
	let top = side === "top" ? trigger.top - tip.height - GAP : side === "bottom" ? trigger.bottom + GAP : trigger.top + (trigger.height - tip.height) / 2;
	let left = side === "left" ? trigger.left - tip.width - GAP : side === "right" ? trigger.right + GAP : trigger.left + (trigger.width - tip.width) / 2;
	// Flip when there's no room on the asked side.
	if (side === "top" && top < EDGE) top = trigger.bottom + GAP;
	if (side === "bottom" && top + tip.height > window.innerHeight - EDGE) top = trigger.top - tip.height - GAP;
	left = Math.min(Math.max(left, EDGE), window.innerWidth - tip.width - EDGE);
	top = Math.min(Math.max(top, EDGE), window.innerHeight - tip.height - EDGE);
	return { top, left };
}

// A short label that appears beside a control on hover or keyboard focus after 400 ms, and hides on Escape,
// pointer down or when the pointer leaves (design system §9). It never holds anything people need to act on.
// `describe` links it with aria-describedby; turn it off when the tip only repeats the control's own name.
export function Tooltip({
	content,
	children,
	side = "top",
	describe = true,
	disabled = false,
}: {
	content: ReactNode;
	children: ReactElement<TriggerProps>;
	side?: Side;
	describe?: boolean;
	disabled?: boolean;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	// The wrapper is display: contents, so the control itself is what gets measured.
	const [wrapper, setWrapper] = useState<HTMLSpanElement | null>(null);
	const [tip, setTip] = useState<HTMLDivElement | null>(null);
	const timer = useRef<number | undefined>(undefined);

	const hide = useCallback(() => {
		window.clearTimeout(timer.current);
		setOpen(false);
		setPosition(null);
	}, []);
	const show = () => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
	};

	useEffect(() => () => window.clearTimeout(timer.current), []);
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") hide();
		};
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", hide, true);
		return () => {
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", hide, true);
		};
	}, [open, hide]);
	useLayoutEffect(() => {
		const control = wrapper?.firstElementChild;
		if (!open || !control || !tip) return;
		const measure = () => setPosition(place(control.getBoundingClientRect(), tip.getBoundingClientRect(), side));
		measure();
	}, [open, side, wrapper, tip]);

	const described = children.props["aria-describedby"];
	const trigger =
		describe && !disabled && open
			? cloneElement(children, { "aria-describedby": [described, id].filter(Boolean).join(" ") })
			: children;

	return (
		<>
			<span
				ref={setWrapper}
				className="contents"
				onPointerEnter={(event: PointerEvent) => {
					if (!disabled && event.pointerType !== "touch") show();
				}}
				onPointerLeave={hide}
				onPointerDown={hide}
				onFocus={(event: FocusEvent) => {
					let visible = true;
					try {
						visible = (event.target as Element).matches(":focus-visible");
					} catch {
						// Older engines: show it on any focus.
					}
					if (!disabled && visible) show();
				}}
				onBlur={hide}
			>
				{trigger}
			</span>
			{open &&
				!disabled &&
				createPortal(
					<div
						ref={setTip}
						id={id}
						role="tooltip"
						aria-hidden={describe ? undefined : true}
						className="tooltip"
						style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
					>
						{content}
					</div>,
					document.body,
				)}
		</>
	);
}
