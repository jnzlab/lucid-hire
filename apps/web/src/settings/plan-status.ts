import type { Billing } from "../lib/billing.ts";
import { formatDate } from "../lib/format.ts";

const ENDED_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

export type Badge = { label: string; tone: "ok" | "warn" | "off" };

// What the status pill says: Active, Trial, Payment overdue, Cancels on a date, or Ended.
export function statusBadge(billing: Billing): Badge {
	const { status, effectivePlan, plan, cancelAtPeriodEnd, currentPeriodEnd } = billing;
	if (status === "past_due") return { label: "Payment overdue", tone: "warn" };
	if (status === "incomplete") return { label: "Awaiting payment", tone: "warn" };
	if (effectivePlan === "free" && (ENDED_STATUSES.includes(status ?? "") || plan !== "free")) {
		return { label: "Ended", tone: "off" };
	}
	if (cancelAtPeriodEnd && effectivePlan !== "free" && currentPeriodEnd) {
		return { label: `Cancels on ${formatDate(currentPeriodEnd)}`, tone: "warn" };
	}
	if (status === "trialing") return { label: "Trial", tone: "ok" };
	return { label: "Active", tone: "ok" };
}
