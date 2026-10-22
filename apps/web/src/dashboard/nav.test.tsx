import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navCurrent, pageTitle } from "./nav.tsx";

const item = (label: string) => NAV_ITEMS.find((entry) => entry.label === label)!;

describe("the sidebar's pages", () => {
	it("lists Jobs, Overview and Settings in that order", () => {
		expect(NAV_ITEMS.map((entry) => entry.label)).toEqual(["Jobs", "Overview", "Settings"]);
	});

	it("marks Settings as the page on /dashboard/settings and as the section on its account pages", () => {
		expect(navCurrent(item("Settings"), "/dashboard/settings")).toBe("page");
		expect(navCurrent(item("Settings"), "/dashboard/settings/security")).toBe("true");
		expect(navCurrent(item("Settings"), "/dashboard")).toBeUndefined();
		expect(navCurrent(item("Jobs"), "/dashboard/settings")).toBeUndefined();
	});

	it("names Settings in the mobile breadcrumb", () => {
		expect(pageTitle("/dashboard/settings")).toBe("Settings");
		expect(pageTitle("/dashboard/settings/security/")).toBe("Settings");
	});
});
