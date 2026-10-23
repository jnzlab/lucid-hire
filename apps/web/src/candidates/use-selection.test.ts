import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "./use-selection.ts";

const setup = (ids: string[]) => renderHook(({ rows }) => useSelection(rows), { initialProps: { rows: ids } });
const checked = (selected: Set<string>) => [...selected].sort();

describe("useSelection", () => {
	it("checks and unchecks rows, with the header checkbox's states", () => {
		const { result } = setup(["a", "b", "c"]);
		expect(result.current).toMatchObject({ allChecked: false, someChecked: false });

		act(() => result.current.toggle("b"));
		expect(checked(result.current.selected)).toEqual(["b"]);
		expect(result.current).toMatchObject({ allChecked: false, someChecked: true });

		act(() => result.current.toggle("a"));
		act(() => result.current.toggle("c"));
		expect(result.current).toMatchObject({ allChecked: true, someChecked: false });

		act(() => result.current.toggle("b"));
		expect(checked(result.current.selected)).toEqual(["a", "c"]);
	});

	it("checks every row, and unchecks them all once every row is checked", () => {
		const { result } = setup(["a", "b", "c"]);
		act(() => result.current.toggle("a"));
		act(() => result.current.toggleAll());
		expect(checked(result.current.selected)).toEqual(["a", "b", "c"]);
		act(() => result.current.toggleAll());
		expect(result.current.selected.size).toBe(0);
		act(() => result.current.toggle("b"));
		act(() => result.current.clear());
		expect(result.current.selected.size).toBe(0);
	});

	it("forgets rows that leave the list, and they don't come back checked", () => {
		const { result, rerender } = setup(["a", "b", "c"]);
		act(() => result.current.toggleAll());
		rerender({ rows: ["a", "c"] });
		expect(checked(result.current.selected)).toEqual(["a", "c"]);
		expect(result.current.allChecked).toBe(true);

		rerender({ rows: ["a", "b", "c"] });
		expect(checked(result.current.selected)).toEqual(["a", "c"]);
		expect(result.current.someChecked).toBe(true);

		rerender({ rows: [] });
		expect(result.current).toMatchObject({ allChecked: false, someChecked: false });
		expect(result.current.selected.size).toBe(0);
	});

	it("ignores rows that aren't in the list", () => {
		const { result } = setup(["a"]);
		act(() => result.current.toggle("z"));
		act(() => result.current.toggleRange?.("z"));
		expect(result.current.selected.size).toBe(0);
	});

	it("checks or unchecks a run of rows from the last one toggled (shift+click)", () => {
		const { result } = setup(["a", "b", "c", "d", "e"]);
		act(() => result.current.toggle("b"));
		act(() => result.current.toggleRange?.("d"));
		expect(checked(result.current.selected)).toEqual(["b", "c", "d"]);

		// Upwards too, and unchecking when the row clicked was checked.
		act(() => result.current.toggleRange?.("c"));
		expect(checked(result.current.selected)).toEqual(["b"]);

		// With nothing toggled yet, it is a plain toggle.
		act(() => result.current.clear());
		act(() => result.current.toggleRange?.("e"));
		expect(checked(result.current.selected)).toEqual(["e"]);
	});
});
