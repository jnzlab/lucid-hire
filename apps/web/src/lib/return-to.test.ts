import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-to.ts";

describe("safeReturnPath", () => {
	it("keeps a dashboard page", () => {
		expect(safeReturnPath("/dashboard/jobs/job_1")).toBe("/dashboard/jobs/job_1");
		expect(safeReturnPath("/dashboard/jobs/job_1/candidates/cand_2")).toBe("/dashboard/jobs/job_1/candidates/cand_2");
	});

	it("drops the dashboard home, since that is the default", () => {
		expect(safeReturnPath("/dashboard")).toBeUndefined();
	});

	it("drops anything that is not a dashboard path", () => {
		for (const value of ["https://evil.example/dashboard", "//evil.example", "/dashboardx", "/dashboard/jobs/1?x=2", "/dashboard//evil.example", "/dashboard/../privacy", "/privacy", "", 7, null, undefined]) {
			expect(safeReturnPath(value)).toBeUndefined();
		}
	});
});
