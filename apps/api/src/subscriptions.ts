import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus, organizations, webhookEvents } from "./db/schema.ts";
import { type PolarFetch, SUBSCRIPTION_EVENTS, type SubscriptionData, orderData, planForProduct, subscriptionData } from "./polar.ts";
import { ACCESS_STATUSES, grantsAccess } from "./plan-state.ts";

export type WebhookOutcome =
	| { kind: "applied"; orgId: string }
	// Valid, but nothing to do: an older event, another subscription, an order we don't act on, an unknown type.
	| { kind: "ignored"; reason: string }
	| { kind: "duplicate" };

// Thrown for events Polar should send again: they match no company yet, or need something we can't reach right now.
export class RetryLater extends Error {}
export class BadPayload extends Error {}

const toStatus = (value: string): SubscriptionStatus | null =>
	(SUBSCRIPTION_STATUSES as readonly string[]).includes(value) ? (value as SubscriptionStatus) : null;

const parseTime = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
};

type OrgRow = typeof organizations.$inferSelect;

// Finds the company a subscription belongs to: our own org id in the checkout metadata first, then the customer's
// external id (also our org id), then the customer id and the subscription id we stored earlier.
async function findOrg(db: Db, data: SubscriptionData): Promise<OrgRow | null> {
	const byId = async (id: unknown) => {
		if (typeof id !== "string" || !id) return null;
		const [row] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
		return row ?? null;
	};
	const customerId = data.customer_id ?? data.customer?.id ?? null;
	const lookups: (() => Promise<OrgRow | null>)[] = [
		() => byId(data.metadata?.org_id),
		() => byId(data.customer?.external_id),
		async () =>
			customerId
				? ((await db.select().from(organizations).where(eq(organizations.polarCustomerId, customerId)).limit(1))[0] ?? null)
				: null,
		async () =>
			(await db.select().from(organizations).where(eq(organizations.polarSubscriptionId, data.id)).limit(1))[0] ?? null,
	];
	for (const lookup of lookups) {
		const org = await lookup();
		if (org) return org;
	}
	return null;
}


// Turns one subscription event into the company's plan state. The event carries Polar's whole subscription, so each
// event is applied as a snapshot, and `modified_at` orders them: a late `updated` can never undo a `revoked` (B1).
export async function applySubscriptionEvent(
	db: Db,
	type: string,
	eventTimestamp: string | null | undefined,
	data: SubscriptionData,
	now: number = Date.now(),
): Promise<WebhookOutcome> {
	const org = await findOrg(db, data);
	if (!org) throw new RetryLater(`no company for subscription ${data.id}`);

	const eventTime = parseTime(data.modified_at) ?? parseTime(eventTimestamp) ?? parseTime(data.created_at) ?? now;
	const revoked = type === "subscription.revoked";
	let status = toStatus(data.status);
	if (revoked) status = "canceled";
	else if (type === "subscription.past_due" && !status) status = "past_due";
	if (!status) throw new BadPayload(`unknown subscription status ${data.status}`);

	const productId = data.product_id ?? data.product?.id ?? null;
	const paidPlan = planForProduct(productId);
	// A product we don't sell can't be granted. Events that end a subscription don't need to know the product.
	if (!paidPlan && !revoked && (ACCESS_STATUSES as readonly string[]).includes(status)) {
		throw new RetryLater(`subscription ${data.id} has an unmapped product ${productId}`);
	}

	const sameSubscription = org.polarSubscriptionId === data.id;
	if (!sameSubscription && org.polarSubscriptionId) {
		// Another subscription than the one on file. It takes over only when ours no longer grants access and this
		// event isn't an ending one; an old subscription's late events must not touch the current one.
		const currentGrants = grantsAccess(org, now);
		const ending = revoked || status === "canceled" || status === "incomplete_expired" || status === "unpaid";
		if (currentGrants || ending) return { kind: "ignored", reason: "another subscription" };
	}

	const periodEnd = parseTime(data.current_period_end);
	const cancelAtPeriodEnd = type === "subscription.canceled" ? (data.cancel_at_period_end ?? true) : type === "subscription.uncanceled" ? false : (data.cancel_at_period_end ?? false);
	const customerId = data.customer_id ?? data.customer?.id ?? org.polarCustomerId;

	const staleGuard = sameSubscription
		? or(isNull(organizations.subscriptionUpdatedAt), lte(organizations.subscriptionUpdatedAt, eventTime))
		: undefined;
	const updated = await db
		.update(organizations)
		.set({
			plan: revoked ? "free" : (paidPlan ?? org.plan),
			polarSubscriptionId: data.id,
			polarCustomerId: customerId,
			subscriptionStatus: status,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd,
			subscriptionUpdatedAt: eventTime,
		})
		.where(
			and(
				eq(organizations.id, org.id),
				org.polarSubscriptionId === null
					? isNull(organizations.polarSubscriptionId)
					: eq(organizations.polarSubscriptionId, org.polarSubscriptionId),
				staleGuard,
			),
		)
		.returning({ id: organizations.id });
	if (updated.length > 0) return { kind: "applied", orgId: org.id };
	// Nothing matched: either this event is older than the stored one, or another event changed the company's
	// subscription since it was read. That one must not be dropped; Polar sends it again and it is judged afresh.
	const [current] = await db
		.select({ polarSubscriptionId: organizations.polarSubscriptionId })
		.from(organizations)
		.where(eq(organizations.id, org.id))
		.limit(1);
	if (current && current.polarSubscriptionId !== org.polarSubscriptionId) {
		throw new RetryLater(`subscription of company ${org.id} changed while event for ${data.id} was applied`);
	}
	return { kind: "ignored", reason: "older than the stored state" };
}

// A refunded order only matters when it belongs to the company's current subscription and Polar no longer shows that
// subscription as active; the refund itself says nothing about the subscription, so Polar is asked.
async function applyRefund(db: Db, polar: PolarFetch, data: unknown, now: number): Promise<WebhookOutcome> {
	const order = orderData.safeParse(data);
	if (!order.success) throw new BadPayload("malformed order");
	const subscriptionId = order.data.subscription_id;
	if (!subscriptionId) return { kind: "ignored", reason: "order without a subscription" };

	const [org] = await db.select().from(organizations).where(eq(organizations.polarSubscriptionId, subscriptionId)).limit(1);
	if (!org) return { kind: "ignored", reason: "not the current subscription" };

	const res = await polar(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
	if (!res.ok) throw new RetryLater(`Polar answered ${res.status} for subscription ${subscriptionId}`);
	const subscription = subscriptionData.safeParse(await res.json());
	if (!subscription.success) throw new BadPayload("malformed subscription from Polar");
	if ((ACCESS_STATUSES as readonly string[]).includes(subscription.data.status)) {
		return { kind: "ignored", reason: "refund left the subscription active" };
	}
	return applySubscriptionEvent(db, "subscription.revoked", null, subscription.data, now);
}

export async function handlePolarEvent(
	db: Db,
	envelope: { type: string; timestamp?: string | null; data: unknown },
	polar: PolarFetch,
	now: number = Date.now(),
): Promise<WebhookOutcome> {
	if (envelope.type === "order.refunded") return applyRefund(db, polar, envelope.data, now);
	if (!SUBSCRIPTION_TYPES.has(envelope.type)) {
		return { kind: "ignored", reason: "unknown event type" };
	}
	const data = subscriptionData.safeParse(envelope.data);
	if (!data.success) throw new BadPayload("malformed subscription");
	return applySubscriptionEvent(db, envelope.type, envelope.timestamp, data.data, now);
}

const SUBSCRIPTION_TYPES = new Set<string>(SUBSCRIPTION_EVENTS);

export async function wasHandled(db: Db, id: string): Promise<boolean> {
	const [row] = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
	return Boolean(row);
}

// Recorded only after the event was handled, so a failed delivery is retried. Safe to repeat.
export async function markHandled(db: Db, id: string, type: string): Promise<void> {
	await db.insert(webhookEvents).values({ id, type }).onConflictDoNothing();
}

