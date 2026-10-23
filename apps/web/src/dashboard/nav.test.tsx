import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SETTINGS_ITEM, backTarget, currentJobId, navCurrent, pageTitle } from "./nav.ts";

const item = (label: string) => NAV_ITEMS.find((entry) => entry.label === label)!;

describe("the dashboard's sections", () => {
	it("lists Overview, Jobs and Candidates in that order, each with a go-to shortcut", () => {
		expect(NAV_ITEMS.map((entry) => entry.label)).toEqual(["Overview", "Jobs", "Candidates"]);
		expect([...NAV_ITEMS, SETTINGS_ITEM].map((entry) => entry.hotkey)).toEqual(["g o", "g j", "g c", "g s"]);
	});

	it("marks Overview on /dashboard only, and Jobs on the list and every job's page", () => {
		expect(navCurrent(item("Overview"), "/dashboard")).toBe("page");
		expect(navCurrent(item("Overview"), "/dashboard/jobs")).toBeUndefined();
		expect(navCurrent(item("Jobs"), "/dashboard")).toBeUndefined();
		expect(navCurrent(item("Jobs"), "/dashboard/jobs/")).toBe("page");
		expect(navCurrent(item("Jobs"), "/dashboard/jobs/job_1")).toBe("true");
		expect(navCurrent(item("Candidates"), "/dashboard/candidates")).toBe("page");
		expect(navCurrent(item("Candidates"), "/dashboard/jobs/job_1/candidates/c_1")).toBeUndefined();
	});

	it("marks Settings as the page on /dashboard/settings and as the section on its sub-pages", () => {
		expect(navCurrent(SETTINGS_ITEM, "/dashboard/settings")).toBe("page");
		expect(navCurrent(SETTINGS_ITEM, "/dashboard/settings/billing")).toBe("true");
		expect(navCurrent(SETTINGS_ITEM, "/dashboard")).toBeUndefined();
		expect(navCurrent(item("Jobs"), "/dashboard/settings")).toBeUndefined();
	});

	it("reads the job from the path, but not the new-job page", () => {
		expect(currentJobId("/dashboard/jobs/job_1")).toBe("job_1");
		expect(currentJobId("/dashboard/jobs/job_1/candidates/c_1")).toBe("job_1");
		expect(currentJobId("/dashboard/jobs/new")).toBeNull();
		expect(currentJobId("/dashboard")).toBeNull();
	});
});

describe("the mobile top bar", () => {
	it("names the page from its path", () => {
		expect(pageTitle("/dashboard")).toBe("Overview");
		expect(pageTitle("/dashboard/jobs")).toBe("Jobs");
		expect(pageTitle("/dashboard/jobs/new")).toBe("Post a job");
		expect(pageTitle("/dashboard/jobs/job_1")).toBe("Job");
		expect(pageTitle("/dashboard/settings")).toBe("Settings");
		expect(pageTitle("/dashboard/settings/billing")).toBe("Plan & billing");
		expect(pageTitle("/dashboard/settings/account/security/")).toBe("Account");
	});

	it("goes back one level from a detail page, and nowhere from a section", () => {
		expect(backTarget("/dashboard/jobs/job_1")).toEqual({ href: "/dashboard/jobs", label: "Back to jobs" });
		expect(backTarget("/dashboard/jobs/job_1/edit")).toEqual({ href: "/dashboard/jobs/job_1", label: "Back to the job" });
		expect(backTarget("/dashboard/jobs/job_1/candidates/c_1")?.href).toBe("/dashboard/jobs/job_1");
		// Opened from the All candidates list: back to that list.
		expect(backTarget("/dashboard/jobs/job_1/candidates/c_1", true)).toEqual({ href: "/dashboard/candidates", label: "Back to candidates" });
		expect(backTarget("/dashboard/jobs")).toBeNull();
		expect(backTarget("/dashboard")).toBeNull();
	});
});
