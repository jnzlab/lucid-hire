import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Hotkey, ariaKeyshortcuts, keyCaps, shortcutText, useHotkeyList, useHotkeys } from "./hotkeys.ts";

function Keys({ hotkeys }: { hotkeys: Hotkey[] }) {
	useHotkeys(hotkeys);
	return null;
}

function Listed() {
	const list = useHotkeyList();
	return (
		<ul aria-label="Listed">
			{list.map((hotkey) => (
				<li key={hotkey.label}>{`${hotkey.group}: ${hotkey.label} (${hotkey.keys.join(", ")})`}</li>
			))}
		</ul>
	);
}

const press = (key: string, init: KeyboardEventInit & { target?: Element } = {}) => {
	const { target = document.body, ...rest } = init;
	fireEvent.keyDown(target, { key, ...rest });
};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("useHotkeys", () => {
	it("runs a shortcut, and passes it the event", () => {
		const run = vi.fn();
		render(<Keys hotkeys={[{ keys: "j", label: "Next", run }]} />);
		press("j");
		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0][0]).toBeInstanceOf(KeyboardEvent);
		expect(run.mock.calls[0][0].defaultPrevented).toBe(true);
	});

	it("waits while typing in a field, unless the shortcut says otherwise", () => {
		const next = vi.fn();
		const palette = vi.fn();
		render(
			<>
				<Keys
					hotkeys={[
						{ keys: "j", label: "Next", run: next },
						{ keys: "mod+k", label: "Palette", run: palette, whileTyping: true },
					]}
				/>
				<input aria-label="Name" />
				<textarea aria-label="Note" />
				<div role="textbox" aria-label="Rich" tabIndex={0} />
				<input type="checkbox" aria-label="Pick" />
			</>,
		);
		for (const field of [screen.getByLabelText("Name"), screen.getByLabelText("Note"), screen.getByLabelText("Rich")]) {
			press("j", { target: field });
		}
		expect(next).not.toHaveBeenCalled();
		press("k", { target: screen.getByLabelText("Name"), ctrlKey: true });
		expect(palette).toHaveBeenCalledTimes(1);
		// A checkbox takes no text.
		press("j", { target: screen.getByLabelText("Pick") });
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("waits while a dialog is open, unless the shortcut works in one", () => {
		const next = vi.fn();
		const close = vi.fn();
		render(
			<>
				<Keys
					hotkeys={[
						{ keys: "j", label: "Next", run: next },
						{ keys: "mod+k", label: "Palette", run: close, inModal: true },
					]}
				/>
				<div role="dialog" aria-modal="true" />
			</>,
		);
		press("j");
		press("k", { metaKey: true });
		expect(next).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("leaves Enter and Space to the focused button", () => {
		const open = vi.fn();
		render(
			<>
				<Keys hotkeys={[{ keys: "Enter", label: "Open", run: open }]} />
				<button type="button">Save</button>
			</>,
		);
		press("Enter", { target: screen.getByRole("button", { name: "Save" }) });
		expect(open).not.toHaveBeenCalled();
		press("Enter");
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("skips keys something else already handled, and disabled shortcuts", () => {
		const run = vi.fn();
		const off = vi.fn();
		render(
			<>
				<Keys
					hotkeys={[
						{ keys: "j", label: "Next", run },
						{ keys: "x", label: "Off", run: off, enabled: false },
					]}
				/>
				<div data-testid="handled" onKeyDown={(event) => event.preventDefault()} />
			</>,
		);
		press("j", { target: screen.getByTestId("handled") });
		press("x");
		expect(run).not.toHaveBeenCalled();
		expect(off).not.toHaveBeenCalled();
	});

	it("matches mod as Ctrl or Cmd, Shift on letters, and symbols as typed", () => {
		const mod = vi.fn();
		const shifted = vi.fn();
		const help = vi.fn();
		render(
			<Keys
				hotkeys={[
					{ keys: "mod+b", label: "Sidebar", run: mod },
					{ keys: "shift+x", label: "Select range", run: shifted },
					{ keys: "?", label: "Help", run: help },
				]}
			/>,
		);
		press("b", { ctrlKey: true });
		press("b", { metaKey: true });
		press("b");
		expect(mod).toHaveBeenCalledTimes(2);
		press("x");
		press("X", { shiftKey: true });
		expect(shifted).toHaveBeenCalledTimes(1);
		press("?", { shiftKey: true });
		expect(help).toHaveBeenCalledTimes(1);
	});

	it("reads letters by their key on other layouts", () => {
		const run = vi.fn();
		render(<Keys hotkeys={[{ keys: "j", label: "Next", run }]} />);
		press("о", { code: "KeyJ" });
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("goes by the letter typed on Latin layouts that move keys (Dvorak, Colemak)", () => {
		const shortlist = vi.fn();
		render(<Keys hotkeys={[{ keys: "s", label: "Shortlist", run: shortlist }]} />);
		// Dvorak's "o" and Colemak's "r" sit where QWERTY has S.
		press("o", { code: "KeyS" });
		press("r", { code: "KeyS" });
		expect(shortlist).not.toHaveBeenCalled();
		// Dvorak's S key types "s" from QWERTY's semicolon position.
		press("s", { code: "Semicolon" });
		expect(shortlist).toHaveBeenCalledTimes(1);
	});

	it("runs a sequence typed within 1.2 seconds, and nothing for its first key alone", () => {
		vi.useFakeTimers();
		const go = vi.fn();
		const other = vi.fn();
		render(
			<Keys
				hotkeys={[
					{ keys: "g o", label: "Go to Overview", run: go },
					{ keys: "o", label: "Open", run: other },
				]}
			/>,
		);
		press("g");
		press("o");
		expect(go).toHaveBeenCalledTimes(1);
		expect(other).not.toHaveBeenCalled();

		press("g");
		vi.advanceTimersByTime(1300);
		press("o");
		expect(go).toHaveBeenCalledTimes(1);
		expect(other).toHaveBeenCalledTimes(1);
	});

	it("doesn't start a sequence while typing", () => {
		const go = vi.fn();
		render(
			<>
				<Keys hotkeys={[{ keys: "g o", label: "Go", run: go }]} />
				<input aria-label="Name" />
			</>,
		);
		const field = screen.getByLabelText("Name");
		press("g", { target: field });
		press("o");
		expect(go).not.toHaveBeenCalled();
	});

	it("gives a key to the most recently mounted component, and uses the latest handler", () => {
		const shell = vi.fn();
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = render(
			<>
				<Keys hotkeys={[{ keys: "n", label: "New", run: shell }]} />
				<Keys hotkeys={[{ keys: "n", label: "Note", run: first }]} />
			</>,
		);
		press("n");
		expect(first).toHaveBeenCalledTimes(1);
		expect(shell).not.toHaveBeenCalled();

		rerender(
			<>
				<Keys hotkeys={[{ keys: "n", label: "New", run: shell }]} />
				<Keys hotkeys={[{ keys: "n", label: "Note", run: second }]} />
			</>,
		);
		press("n");
		expect(second).toHaveBeenCalledTimes(1);
	});
});

describe("useHotkeyList", () => {
	it("lists what's registered and enabled, and follows mounts and changes", () => {
		const run = () => {};
		const { rerender } = render(
			<>
				<Listed />
				<Keys hotkeys={[{ keys: "mod+k", label: "Search", group: "Global", run }]} />
				<Keys
					hotkeys={[
						{ keys: ["j", "ArrowDown"], label: "Next", group: "Lists", run },
						{ keys: "s", label: "Shortlist", run, enabled: false },
						{ keys: "Escape", label: "Hidden", run, hidden: true },
					]}
				/>
			</>,
		);
		const items = () => screen.getAllByRole("listitem").map((item) => item.textContent);
		expect(items()).toEqual(["Global: Search (mod+k)", "Lists: Next (j, ArrowDown)"]);

		act(() =>
			rerender(
				<>
					<Listed />
					<Keys hotkeys={[{ keys: "mod+k", label: "Search", group: "Global", run }]} />
					<Keys
						hotkeys={[
							{ keys: ["j", "ArrowDown"], label: "Next", group: "Lists", run },
							{ keys: "s", label: "Shortlist", run, enabled: true },
						]}
					/>
				</>,
			),
		);
		expect(items()).toEqual(["Global: Search (mod+k)", "Lists: Next (j, ArrowDown)", "This page: Shortlist (s)"]);

		act(() =>
			rerender(
				<>
					<Listed />
					<Keys hotkeys={[{ keys: "mod+k", label: "Search", group: "Global", run }]} />
				</>,
			),
		);
		expect(items()).toEqual(["Global: Search (mod+k)"]);
	});
});

describe("showing shortcuts", () => {
	it("names keys for Macs and for everything else", () => {
		expect(keyCaps("mod+k", false)).toEqual([["Ctrl", "K"]]);
		expect(keyCaps("mod+k", true)).toEqual([["⌘", "K"]]);
		expect(keyCaps("g o", false)).toEqual([["G"], ["O"]]);
		expect(shortcutText("mod+shift+x", false)).toBe("Ctrl Shift X");
		expect(shortcutText("mod+k", true)).toBe("⌘K");
		expect(shortcutText("g j", false)).toBe("G then J");
		expect(shortcutText("ArrowDown", false)).toBe("↓");
	});

	it("writes aria-keyshortcuts for single keys only", () => {
		expect(ariaKeyshortcuts("mod+k")).toBe("Control+K Meta+K");
		expect(ariaKeyshortcuts(["j", "ArrowDown"])).toBe("J ArrowDown");
		expect(ariaKeyshortcuts("g o")).toBeUndefined();
	});
});
