import type { ReactNode } from "react";
import { IS_APPLE, keyCaps } from "../lib/hotkeys.ts";

// One key drawn as a keycap, for shortcut hints: <Kbd>⌘K</Kbd>.
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
	return <kbd className={`kbd ${className}`}>{children}</kbd>;
}

// A shortcut from a hotkey spec ("mod+k", "g o", "?") as keycaps, with ⌘ on Apple devices and Ctrl elsewhere.
// Sequences read "G then O". Screen readers get the same words.
export function Shortcut({ keys, className = "" }: { keys: string; className?: string }) {
	const steps = keyCaps(keys, IS_APPLE);
	return (
		<span className={`inline-flex flex-none items-center gap-1 ${className}`}>
			{steps.map((caps, index) => (
				<span key={index} className="inline-flex items-center gap-1">
					{index > 0 && <span className="font-mono text-[11.5px] text-ink-muted">then</span>}
					<Kbd>{caps.join(IS_APPLE ? "" : " ")}</Kbd>
				</span>
			))}
		</span>
	);
}
