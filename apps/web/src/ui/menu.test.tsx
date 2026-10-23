import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuGroup, MenuItem, MenuSeparator } from "./menu.tsx";

afterEach(cleanup);

function Actions({ onSelect = () => {} }: { onSelect?: (name: string) => void }) {
	return (
		<>
			<Menu label="Actions for Backend Engineer" trigger="Actions">
				<MenuItem onSelect={() => onSelect("edit")}>Edit job</MenuItem>
				<MenuItem onSelect={() => onSelect("duplicate")}>Duplicate</MenuItem>
				<MenuItem disabled onSelect={() => onSelect("export")}>
					Export CSV
				</MenuItem>
				<MenuItem onSelect={() => onSelect("download")}>Download CVs</MenuItem>
				<MenuSeparator />
				<MenuItem destructive onSelect={() => onSelect("delete")}>
					Delete job
				</MenuItem>
			</Menu>
			<button type="button">Elsewhere</button>
		</>
	);
}

const trigger = () => screen.getByRole("button", { name: "Actions for Backend Engineer" });
const focused = () => document.activeElement?.textContent;
const key = (name: string) => fireEvent.keyDown(document.activeElement as Element, { key: name });

describe("Menu", () => {
	it("opens on click with the first item focused, and says so on the button", () => {
		render(<Actions />);
		expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger());
		const menu = screen.getByRole("menu", { name: "Actions for Backend Engineer" });
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(trigger().getAttribute("aria-controls")).toBe(menu.id);
		expect(focused()).toBe("Edit job");
		expect(within(menu).getByRole("menuitem", { name: "Export CSV" }).getAttribute("aria-disabled")).toBe("true");
	});

	it("moves with the arrow keys, Home and End, wrapping and skipping disabled items", () => {
		render(<Actions />);
		fireEvent.click(trigger());
		key("ArrowDown");
		expect(focused()).toBe("Duplicate");
		key("ArrowDown");
		expect(focused()).toBe("Download CVs");
		key("End");
		expect(focused()).toBe("Delete job");
		key("ArrowDown");
		expect(focused()).toBe("Edit job");
		key("ArrowUp");
		expect(focused()).toBe("Delete job");
		key("Home");
		expect(focused()).toBe("Edit job");
	});

	it("opens on the last item with ArrowUp on the button, and the first with ArrowDown", () => {
		render(<Actions />);
		trigger().focus();
		fireEvent.keyDown(trigger(), { key: "ArrowUp" });
		expect(focused()).toBe("Delete job");
		key("Escape");
		fireEvent.keyDown(trigger(), { key: "ArrowDown" });
		expect(focused()).toBe("Edit job");
	});

	it("jumps to the next item starting with a typed letter", () => {
		render(<Actions />);
		fireEvent.click(trigger());
		key("d");
		expect(focused()).toBe("Duplicate");
		key("d");
		expect(focused()).toBe("Download CVs");
		key("d");
		expect(focused()).toBe("Delete job");
	});

	it("runs an item with Enter, closes, and gives focus back to the button", () => {
		const onSelect = vi.fn();
		render(<Actions onSelect={onSelect} />);
		fireEvent.click(trigger());
		key("ArrowDown");
		key("Enter");
		expect(onSelect).toHaveBeenCalledWith("duplicate");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger());
	});

	it("does nothing for a disabled item", () => {
		const onSelect = vi.fn();
		render(<Actions onSelect={onSelect} />);
		fireEvent.click(trigger());
		fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV" }));
		expect(onSelect).not.toHaveBeenCalled();
		expect(screen.getByRole("menu")).toBeTruthy();
	});

	it("closes on Escape and Tab with focus back, and on a click outside", () => {
		render(<Actions />);
		fireEvent.click(trigger());
		key("Escape");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger());

		fireEvent.click(trigger());
		key("Tab");
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.click(trigger());
		fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("toggles shut when its button is clicked again", () => {
		render(<Actions />);
		fireEvent.click(trigger());
		fireEvent.click(trigger());
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("draws radio items with their state, and can stay open after a choice", () => {
		const onSelect = vi.fn();
		render(
			<Menu label="Sort" trigger="Sort">
				<MenuGroup label="Sort by">
					<MenuItem checked onSelect={() => onSelect("newest")}>
						Newest
					</MenuItem>
					<MenuItem checked={false} closeOnSelect={false} onSelect={() => onSelect("score")}>
						Score
					</MenuItem>
				</MenuGroup>
			</Menu>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Sort" }));
		const group = screen.getByRole("group", { name: "Sort by" });
		expect(within(group).getByRole("menuitemradio", { name: "Newest" }).getAttribute("aria-checked")).toBe("true");
		fireEvent.click(within(group).getByRole("menuitemradio", { name: "Score" }));
		expect(onSelect).toHaveBeenCalledWith("score");
		expect(screen.getByRole("menu")).toBeTruthy();
	});

	it("renders a custom trigger from the props it's given", () => {
		render(
			<Menu
				trigger={(props) => (
					<button {...props} aria-label="Status: Open">
						Open
					</button>
				)}
			>
				<MenuItem>Close job</MenuItem>
			</Menu>,
		);
		const button = screen.getByRole("button", { name: "Status: Open" });
		fireEvent.click(button);
		expect(screen.getByRole("menu").getAttribute("aria-labelledby")).toBe(button.id);
		expect(focused()).toBe("Close job");
	});
});
