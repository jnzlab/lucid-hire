import type { ComponentProps, ReactNode } from "react";
import { ariaKeyshortcuts, shortcutText } from "../lib/hotkeys.ts";
import { type Side, Tooltip } from "./tooltip.tsx";

// A 44px button that shows only an icon. Its name is in an sr-only label, and a tooltip repeats it (with the
// shortcut, when it has one) for people using a mouse.
export function IconButton({
	label,
	icon,
	tooltip = label,
	shortcut,
	tooltipSide = "top",
	variant = "ghost",
	className = "",
	type = "button",
	...props
}: Omit<ComponentProps<"button">, "children"> & {
	// The accessible name: "Collapse sidebar".
	label: string;
	icon: ReactNode;
	// What the tooltip says; false for none. Defaults to the label.
	tooltip?: string | false;
	// A hotkey spec ("mod+b"), shown in the tooltip and announced through aria-keyshortcuts.
	shortcut?: string;
	tooltipSide?: Side;
	// `ghost` sits on paper or a panel; `outline` adds the 1.5px line border, for a button on its own.
	variant?: "ghost" | "outline";
}) {
	const button = (
		<button
			type={type}
			aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
			className={`icon-btn ${variant === "outline" ? "icon-btn-outline" : ""} ${className}`}
			{...props}
		>
			{icon}
			<span className="sr-only">{label}</span>
		</button>
	);
	if (tooltip === false) return button;
	return (
		<Tooltip
			side={tooltipSide}
			describe={tooltip !== label || Boolean(shortcut)}
			content={
				<>
					{tooltip}
					{shortcut && <span className="ml-2 text-paper/70">{shortcutText(shortcut)}</span>}
				</>
			}
		>
			{button}
		</Tooltip>
	);
}
