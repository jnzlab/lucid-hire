import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";

// Keyboard shortcuts for the dashboard. Components declare theirs with `useHotkeys`; one document listener runs
// them, and the help sheet (`?`) lists whatever is registered and enabled right now.
//
// Key syntax: a step is a key with optional modifiers joined by "+" ("j", "?", "/", "mod+k", "shift+x",
// "ArrowDown", "Escape", "Enter"). `mod` is Ctrl, or ⌘ on a Mac (either works everywhere). Two steps separated
// by a space are a sequence typed one after the other ("g o").
export type Hotkey = {
	// One key spec, or several that do the same thing (["j", "ArrowDown"]); the help sheet shows them together.
	keys: string | string[];
	// What it does, as the help sheet says it: "Next candidate".
	label: string;
	// The help sheet's heading for it. Defaults to "This page".
	group?: string;
	run: (event: KeyboardEvent) => void;
	// When false it is neither listened for nor listed.
	enabled?: boolean;
	// Also runs while focus is in a text field. Only for modifier shortcuts and Escape.
	whileTyping?: boolean;
	// Also runs while a dialog, drawer or the command palette is open.
	inModal?: boolean;
	// Listened for but not listed in the help sheet.
	hidden?: boolean;
};

export type ListedHotkey = { keys: string[]; label: string; group: string };

export const HOTKEY_GROUPS = ["Global", "Lists", "Job triage"] as const;
const DEFAULT_GROUP = "This page";
// How long the second key of a sequence ("g" then "o") may take.
const SEQUENCE_MS = 1200;

type Entry = { order: number; get: () => Hotkey[]; listed: ListedHotkey[] };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let listing: ListedHotkey[] = [];
let counter = 0;

// --- Matching ---------------------------------------------------------------------------------------------

type Pressed = { key: string; code: string; mod: boolean; shift: boolean; alt: boolean; at: number };
type Step = { key: string; mod: boolean; shift: boolean; alt: boolean };

const asList = (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]);
const stepsOf = (spec: string) => spec.trim().split(/\s+/);

function parseStep(step: string): Step {
	const parts = step.split("+");
	// "+" itself would be the last, empty part.
	const key = parts.pop() || "+";
	const mods = new Set(parts.map((part) => part.toLowerCase()));
	return { key: key.toLowerCase(), mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt") };
}

function pressedOf(event: KeyboardEvent): Pressed | null {
	if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified"].includes(event.key)) return null;
	return {
		key: event.key.toLowerCase(),
		code: event.code,
		mod: event.ctrlKey || event.metaKey,
		shift: event.shiftKey,
		alt: event.altKey,
		at: event.timeStamp || performance.now(),
	};
}

function stepMatches(spec: string, pressed: Pressed): boolean {
	const step = parseStep(spec);
	if (step.mod !== pressed.mod || step.alt !== pressed.alt) return false;
	const letter = /^[a-z]$/.test(step.key);
	// A symbol such as "?" already says whether Shift was held, so Shift only counts for letters and named keys.
	if ((letter || step.key.length > 1) && step.shift !== pressed.shift) return false;
	if (pressed.key === step.key) return true;
	// Non-Latin layouts (Cyrillic, Greek…): the J key still means "j" when it types another alphabet. A Latin layout
	// that moves letters around (Dvorak, Colemak) goes by the letter typed, never by the key's position.
	return letter && !/^[a-z]$/i.test(pressed.key) && pressed.code === `Key${step.key.toUpperCase()}`;
}

// True while focus is somewhere text goes, so typing a "j" in a field never moves the selection.
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
	if (target instanceof HTMLInputElement) {
		return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
	}
	if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
	return ["textbox", "combobox", "searchbox"].includes(target.getAttribute("role") ?? "");
}

// A dialog, drawer or sheet is open: page shortcuts wait until it closes.
export function isModalOpen(): boolean {
	return document.querySelector('[aria-modal="true"]') !== null;
}

// Enter and Space belong to the focused button or link, not to a page shortcut.
const INTERACTIVE =
	'a[href],button,summary,input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"]';

let pending: Pressed | null = null;

function onKeyDown(event: KeyboardEvent) {
	if (event.defaultPrevented || event.isComposing) return;
	const pressed = pressedOf(event);
	if (!pressed) return;
	const previous = pending && pressed.at - pending.at < SEQUENCE_MS ? pending : null;
	pending = null;

	const typing = isTyping(event.target);
	const modal = isModalOpen();
	const activation = (pressed.key === "enter" || pressed.key === " ") && !pressed.mod;
	const onControl = event.target instanceof Element && event.target.closest(INTERACTIVE) !== null;
	const allowed = (hotkey: Hotkey) =>
		(!typing || hotkey.whileTyping) && (!modal || hotkey.inModal) && !(activation && onControl);

	// The most recently registered first, so a page can take a key the shell also uses.
	const active = [...entries.values()]
		.sort((a, b) => b.order - a.order)
		.flatMap((entry) => entry.get())
		.filter((hotkey) => hotkey.enabled !== false);

	const fire = (hotkey: Hotkey) => {
		event.preventDefault();
		hotkey.run(event);
	};

	// Sequences first, so "g j" wins over a page's "j".
	if (previous) {
		for (const hotkey of active) {
			for (const spec of asList(hotkey.keys)) {
				const [first, second, ...rest] = stepsOf(spec);
				if (second && rest.length === 0 && stepMatches(first, previous) && stepMatches(second, pressed) && allowed(hotkey)) {
					return fire(hotkey);
				}
			}
		}
	}
	if (event.repeat && pressed.mod) return;
	for (const hotkey of active) {
		for (const spec of asList(hotkey.keys)) {
			const steps = stepsOf(spec);
			if (steps.length === 1 && stepMatches(steps[0], pressed) && allowed(hotkey)) return fire(hotkey);
		}
	}
	// Not a shortcut by itself; it may start a sequence.
	if (typing || modal || event.repeat) return;
	const starts = active.some((hotkey) =>
		asList(hotkey.keys).some((spec) => {
			const steps = stepsOf(spec);
			return steps.length === 2 && stepMatches(steps[0], pressed);
		}),
	);
	if (starts) pending = pressed;
}

// --- Registry ---------------------------------------------------------------------------------------------

function relist() {
	listing = [...entries.values()].sort((a, b) => a.order - b.order).flatMap((entry) => entry.listed);
	for (const listener of listeners) listener();
}

function describe(hotkeys: Hotkey[]): ListedHotkey[] {
	return hotkeys
		.filter((hotkey) => hotkey.enabled !== false && !hotkey.hidden)
		.map((hotkey) => ({ keys: asList(hotkey.keys), label: hotkey.label, group: hotkey.group ?? DEFAULT_GROUP }));
}

function register(id: string, get: () => Hotkey[]) {
	if (entries.size === 0) document.addEventListener("keydown", onKeyDown);
	entries.set(id, { order: ++counter, get, listed: describe(get()) });
	relist();
	return () => {
		entries.delete(id);
		if (entries.size === 0) {
			document.removeEventListener("keydown", onKeyDown);
			pending = null;
		}
		relist();
	};
}

// Registers shortcuts while the component is mounted. The handlers may be new functions on every render; the
// help sheet only updates when a key, label, group or `enabled` changes.
//
//   useHotkeys([
//     { keys: ["j", "ArrowDown"], label: "Next candidate", group: "Job triage", run: next },
//     { keys: "s", label: "Shortlist", group: "Job triage", run: shortlist, enabled: Boolean(selected) },
//   ]);
export function useHotkeys(hotkeys: Hotkey[]) {
	const id = useId();
	const latest = useRef(hotkeys);
	useLayoutEffect(() => {
		latest.current = hotkeys;
	});
	const signature = JSON.stringify(describe(hotkeys));

	useEffect(() => register(id, () => latest.current), [id]);
	useEffect(() => {
		const entry = entries.get(id);
		if (!entry) return;
		entry.listed = JSON.parse(signature) as ListedHotkey[];
		relist();
	}, [id, signature]);
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

// Every listed shortcut that is active now, in registration order. For the help sheet.
export function useHotkeyList(): ListedHotkey[] {
	return useSyncExternalStore(subscribe, () => listing, () => listing);
}

// --- Display ----------------------------------------------------------------------------------------------

export const IS_APPLE =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

const NAMES: Record<string, [apple: string, other: string]> = {
	mod: ["⌘", "Ctrl"],
	shift: ["⇧", "Shift"],
	alt: ["⌥", "Alt"],
	escape: ["Esc", "Esc"],
	enter: ["Enter", "Enter"],
	arrowup: ["↑", "↑"],
	arrowdown: ["↓", "↓"],
	arrowleft: ["←", "←"],
	arrowright: ["→", "→"],
	" ": ["Space", "Space"],
};

// The keycaps for one spec: [["Ctrl", "K"]] or, for a sequence, [["G"], ["O"]].
export function keyCaps(spec: string, apple = IS_APPLE): string[][] {
	return stepsOf(spec).map((step) => {
		const parts = step.split("+");
		const key = parts.pop() || "+";
		return [...parts, key].map((part) => {
			const name = NAMES[part.toLowerCase()];
			if (name) return apple ? name[0] : name[1];
			return part.length === 1 ? part.toUpperCase() : part;
		});
	});
}

// The same spec as words for a tooltip or a title: "Ctrl K", "⌘K", "G then O".
export function shortcutText(spec: string, apple = IS_APPLE): string {
	return keyCaps(spec, apple)
		.map((caps) => caps.join(apple ? "" : " "))
		.join(" then ");
}

// The `aria-keyshortcuts` value for single-step specs ("mod+k" → "Control+K Meta+K"). Sequences have no ARIA form.
export function ariaKeyshortcuts(keys: string | string[]): string | undefined {
	const values = asList(keys)
		.filter((spec) => stepsOf(spec).length === 1)
		.flatMap((spec) => {
			const parts = spec.split("+");
			const key = parts.pop() || "+";
			const name = key.length === 1 ? key.toUpperCase() : key;
			const mods = parts.map((part) => (part === "shift" ? "Shift" : part === "alt" ? "Alt" : part));
			const join = (mod: string[]) => [...mod, name].join("+");
			return mods.includes("mod")
				? [join(mods.map((m) => (m === "mod" ? "Control" : m))), join(mods.map((m) => (m === "mod" ? "Meta" : m)))]
				: [join(mods)];
		});
	return values.length ? values.join(" ") : undefined;
}
