import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./tabs.tsx";

afterEach(cleanup);

function JobTabs({ activation }: { activation?: "automatic" | "manual" }) {
	const [tab, setTab] = useState("candidates");
	return (
		<Tabs value={tab} onChange={setTab} activation={activation}>
			<TabList label="Job">
				<Tab value="candidates" count={14}>
					Candidates
				</Tab>
				<Tab value="description">Description</Tab>
				<Tab value="questions" disabled>
					Questions
				</Tab>
				<Tab value="public page">Public page</Tab>
			</TabList>
			<TabPanel value="candidates">The ranked list</TabPanel>
			<TabPanel value="description">About the role</TabPanel>
			<TabPanel value="public page">The apply page</TabPanel>
		</Tabs>
	);
}

const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
const key = (name: string) => fireEvent.keyDown(document.activeElement as Element, { key: name });

describe("Tabs", () => {
	it("has one tab stop on the chosen tab, wired to its panel", () => {
		render(<JobTabs />);
		expect(screen.getByRole("tablist", { name: "Job" })).toBeTruthy();
		const candidates = tab(/Candidates/);
		expect(candidates.textContent).toContain("14");
		expect(candidates.getAttribute("aria-selected")).toBe("true");
		expect(candidates.tabIndex).toBe(0);
		expect(tab("Description").tabIndex).toBe(-1);
		const panel = screen.getByRole("tabpanel");
		expect(panel.getAttribute("aria-labelledby")).toBe(candidates.id);
		expect(candidates.getAttribute("aria-controls")).toBe(panel.id);
		expect(panel.textContent).toBe("The ranked list");
	});

	it("moves and chooses with the arrow keys, skipping disabled tabs and wrapping", () => {
		render(<JobTabs />);
		tab(/Candidates/).focus();
		key("ArrowRight");
		expect(document.activeElement).toBe(tab("Description"));
		expect(tab("Description").getAttribute("aria-selected")).toBe("true");
		expect(tab("Description").tabIndex).toBe(0);
		expect(screen.getByRole("tabpanel").textContent).toBe("About the role");

		key("ArrowRight");
		expect(document.activeElement).toBe(tab("Public page"));
		expect(screen.getByRole("tabpanel").textContent).toBe("The apply page");
		key("ArrowRight");
		expect(document.activeElement).toBe(tab(/Candidates/));
		key("ArrowLeft");
		expect(document.activeElement).toBe(tab("Public page"));
		key("Home");
		expect(document.activeElement).toBe(tab(/Candidates/));
		key("End");
		expect(document.activeElement).toBe(tab("Public page"));
	});

	it("waits for Enter, Space or a click with manual activation", () => {
		render(<JobTabs activation="manual" />);
		tab(/Candidates/).focus();
		key("ArrowRight");
		expect(document.activeElement).toBe(tab("Description"));
		expect(tab(/Candidates/).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toBe("The ranked list");
		fireEvent.click(tab("Description"));
		expect(tab("Description").getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toBe("About the role");
	});

	it("makes valid ids from values with spaces", () => {
		render(<JobTabs />);
		fireEvent.click(tab("Public page"));
		const panel = screen.getByRole("tabpanel", { name: "Public page" });
		expect(panel.id).not.toContain(" ");
	});
});
