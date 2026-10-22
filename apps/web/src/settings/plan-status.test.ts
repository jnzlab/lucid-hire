import { describe, expect, it } from "vitest";
import type { Billing } from "../lib/billing.ts";
import { statusBadge } from "./plan-status.ts";

const billing = (fields: Partial<Billing>): Billing => ({
	plan: "pro",
	effectivePlan: "pro",
	status: "active",
	currentPeriodEnd: "2026-11-20T00:00:00Z",
	cancelAtPeriodEnd: false,
	usage: { jobsThisMonth: 0, jobsLimit: 20, busiestJob: null, cvLimit: 100, aiThisHour: 0, aiLimit: 150 },
	isAdmin: true,
	...fields,
});

describe("statusBadge", () => {
	it("says Active for a paying plan", () => {
		expect(statusBadge(billing({}))).toEqual({ label: "Active", tone: "ok" });
	});

	it("says Trial while a trial runs, in the same tone as Active", () => {
		expect(statusBadge(billing({ status: "trialing" }))).toEqual({ label: "Trial", tone: "ok" });
	});

	it("still says when a trial will be cancelled", () => {
		expect(statusBadge(billing({ status: "trialing", cancelAtPeriodEnd: true })).label).toBe("Cancels on 20 Nov 2026");
	});

	it("warns about a failed or unfinished payment", () => {
		expect(statusBadge(billing({ status: "past_due" }))).toEqual({ label: "Payment overdue", tone: "warn" });
		expect(statusBadge(billing({ status: "incomplete" }))).toEqual({ label: "Awaiting payment", tone: "warn" });
	});

	it("says Ended once the plan has dropped back to Free", () => {
		expect(statusBadge(billing({ status: "canceled", effectivePlan: "free" }))).toEqual({ label: "Ended", tone: "off" });
	});
});
