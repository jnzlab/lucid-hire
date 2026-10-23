import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog.tsx";
import { Drawer } from "./drawer.tsx";

afterEach(cleanup);

function Opener({ dismissable = true, onClose }: { dismissable?: boolean; onClose?: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			<Dialog
				open={open}
				title="Rename job"
				description="Candidates keep their scores."
				dismissable={dismissable}
				onClose={() => {
					onClose?.();
					setOpen(false);
				}}
				footer={
					<>
						<button type="button">Cancel</button>
						<button type="button">Save</button>
					</>
				}
			>
				<input aria-label="Title" />
			</Dialog>
		</>
	);
}

const open = () => {
	const button = screen.getByRole("button", { name: "Open" });
	button.focus();
	fireEvent.click(button);
	return button;
};

describe("Dialog", () => {
	it("is a labelled modal dialog that starts on its first field, not the close button", () => {
		render(<Opener />);
		open();
		const dialog = screen.getByRole("dialog", { name: "Rename job" });
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText("Candidates keep their scores.").id);
		expect(document.activeElement).toBe(screen.getByLabelText("Title"));
		expect(document.body.style.overflow).toBe("hidden");
	});

	it("keeps Tab and Shift+Tab inside", () => {
		render(<Opener />);
		open();
		const dialog = screen.getByRole("dialog");
		const close = within(dialog).getByRole("button", { name: "Close" });
		close.focus();
		fireEvent.keyDown(document, { key: "Tab" });
		expect(document.activeElement).toBe(screen.getByLabelText("Title"));
		fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(close);
	});

	it("closes on Escape and gives focus back to the opener, and the page scrolls again", () => {
		render(<Opener />);
		const button = open();
		fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(button);
		expect(document.body.style.overflow).toBe("");
	});

	it("closes from the close button and from a click on the dimmed page, but not from inside", () => {
		const onClose = vi.fn();
		render(<Opener onClose={onClose} />);
		open();
		fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledTimes(1);

		open();
		const dialog = screen.getByRole("dialog");
		fireEvent.mouseDown(dialog);
		fireEvent.click(dialog);
		expect(screen.getByRole("dialog")).toBeTruthy();
		// A press that starts in the field and ends on the backdrop (selecting text) doesn't close it.
		const backdrop = dialog.parentElement as HTMLElement;
		fireEvent.mouseDown(screen.getByLabelText("Title"));
		fireEvent.click(backdrop);
		expect(screen.getByRole("dialog")).toBeTruthy();
		fireEvent.mouseDown(backdrop);
		fireEvent.click(backdrop);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("stays open while it can't be dismissed", () => {
		render(<Opener dismissable={false} />);
		open();
		fireEvent.keyDown(document, { key: "Escape" });
		const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
		fireEvent.mouseDown(backdrop);
		fireEvent.click(backdrop);
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("focuses the panel when there's nothing else to focus, and honours initialFocus", () => {
		function Picked() {
			const save = useRef<HTMLButtonElement>(null);
			return (
				<Dialog title="Pick" onClose={() => {}} initialFocus={save} footer={<button type="button">Cancel</button>}>
					<button ref={save} type="button">
						Save
					</button>
				</Dialog>
			);
		}
		const { unmount } = render(
			<Dialog title="Note" onClose={() => {}}>
				<p>Nothing to do here.</p>
			</Dialog>,
		);
		expect(document.activeElement).toBe(screen.getByRole("dialog"));
		unmount();

		render(<Picked />);
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
	});

	it("lets only the top layer answer Escape, and gives focus back through the stack", () => {
		function Stack() {
			const [drawer, setDrawer] = useState(true);
			const [confirm, setConfirm] = useState(false);
			return drawer ? (
				<Drawer title="Candidate" onClose={() => setDrawer(false)}>
					<button type="button" onClick={() => setConfirm(true)}>
						Delete
					</button>
					<Dialog role="alertdialog" open={confirm} title="Delete Grace?" closeButton={false} onClose={() => setConfirm(false)}>
						<button type="button">Keep</button>
					</Dialog>
				</Drawer>
			) : null;
		}
		render(<Stack />);
		const remove = screen.getByRole("button", { name: "Delete" });
		remove.focus();
		fireEvent.click(remove);
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(screen.getByRole("dialog", { name: "Candidate" })).toBeTruthy();
		expect(document.activeElement).toBe(remove);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
