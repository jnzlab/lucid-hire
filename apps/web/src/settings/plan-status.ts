import { PLANS } from "@lucid-hire/plans";
import type { Billing } from "../lib/billing.ts";
import { formatDate } from "../lib/format.ts";

const ENDED_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

export type Badge = { label: string; tone: "ok" | "warn" | "off" };

// A paid plan that has dropped back to Free: cancelled and run out, or never paid.
const hasEnded = ({ effectivePlan, plan, status }: Billing) =>
	effectivePlan === "free" && (ENDED_STATUSES.includes(status ?? "") || plan !== "free");

// What the status pill says: Active, Trial, Payment overdue, Cancels on a date, or Ended.
export function statusBadge(billing: Billing): Badge {
	const { status, effectivePlan, cancelAtPeriodEnd, currentPeriodEnd } = billing;
	if (status === "past_due") return { label: "Payment overdue", tone: "warn" };
	if (status === "incomplete") return { label: "Awaiting payment", tone: "warn" };
	if (hasEnded(billing)) return { label: "Ended", tone: "off" };
	if (cancelAtPeriodEnd && effectivePlan !== "free" && currentPeriodEnd) {
		return { label: `Cancels on ${formatDate(currentPeriodEnd)}`, tone: "warn" };
	}
	if (status === "trialing") return { label: "Trial", tone: "ok" };
	return { label: "Active", tone: "ok" };
}

// One plain sentence under the plan's name about what happens next: when it renews, when it ends, or that Free
// never does.
export function renewalLine(billing: Billing): string {
	const { effectivePlan, plan, status, cancelAtPeriodEnd, currentPeriodEnd } = billing;
	const price = `$${PLANS[effectivePlan].priceUsd} a month`;
	if (effectivePlan === "free") {
		if (!hasEnded(billing)) return "No card needed. Free doesn't renew or run out.";
		return plan === "free" ? "Your paid plan has ended. You're on Free now." : `Your ${PLANS[plan].name} plan has ended. You're on Free now.`;
	}
	if (status === "past_due") return "The last payment failed. Update the payment method to keep the plan.";
	if (status === "incomplete") return "Waiting for the first payment to go through.";
	if (cancelAtPeriodEnd && currentPeriodEnd) return `Ends on ${formatDate(currentPeriodEnd)}, then you're on Free.`;
	if (!currentPeriodEnd) return price;
	if (status === "trialing") return `Trial until ${formatDate(currentPeriodEnd)}, then ${price}.`;
	return `Renews on ${formatDate(currentPeriodEnd)} · ${price}`;
}
