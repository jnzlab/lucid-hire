import { describe, expect, it } from "vitest";
import type { Billing } from "../lib/billing.ts";
import { renewalLine, statusBadge } from "./plan-status.ts";

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

describe("renewalLine", () => {
	it("gives the renewal date and price for a paying plan", () => {
		expect(renewalLine(billing({}))).toBe("Renews on 20 Nov 2026 · $10 a month");
		expect(renewalLine(billing({ plan: "max", effectivePlan: "max" }))).toBe("Renews on 20 Nov 2026 · $30 a month");
	});

	it("falls back to the price when the period end isn't known yet", () => {
		expect(renewalLine(billing({ currentPeriodEnd: null }))).toBe("$10 a month");
	});

	it("says when a trial turns into a paid plan", () => {
		expect(renewalLine(billing({ status: "trialing" }))).toBe("Trial until 20 Nov 2026, then $10 a month.");
	});

	it("says when a cancelled plan ends, before the trial or renewal", () => {
		expect(renewalLine(billing({ cancelAtPeriodEnd: true }))).toBe("Ends on 20 Nov 2026, then you're on Free.");
		expect(renewalLine(billing({ status: "trialing", cancelAtPeriodEnd: true }))).toBe("Ends on 20 Nov 2026, then you're on Free.");
	});

	it("explains a failed or unfinished payment", () => {
		expect(renewalLine(billing({ status: "past_due" }))).toBe("The last payment failed. Update the payment method to keep the plan.");
		expect(renewalLine(billing({ status: "incomplete" }))).toBe("Waiting for the first payment to go through.");
	});

	it("tells Free it never renews or runs out", () => {
		expect(renewalLine(billing({ plan: "free", effectivePlan: "free", status: null, currentPeriodEnd: null }))).toBe(
			"No card needed. Free doesn't renew or run out.",
		);
	});

	it("names the plan that has ended", () => {
		expect(renewalLine(billing({ status: "canceled", effectivePlan: "free" }))).toBe("Your Pro plan has ended. You're on Free now.");
		expect(renewalLine(billing({ plan: "free", status: "unpaid", effectivePlan: "free" }))).toBe("Your paid plan has ended. You're on Free now.");
	});
});
