import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { POLAR } from "./config.ts";
import { type Db, getDb } from "./db/client.ts";
import { organizations, webhookEvents } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { effectivePlan } from "./plan-state.ts";
import { type PolarFetch, signWebhook, verifyWebhook } from "./polar.ts";
import { createTestD1 } from "./test/d1.ts";

vi.setConfig({ testTimeout: 30_000 });

const SECRET = "polar_whs_unit_test_secret";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12);

let db: Db;
let env: Env;
let dispose: () => Promise<void>;
let polarCalls: string[];
let polarSubscription: Record<string, unknown>;

const app = createApp({
	polar: () => (async (path) => {
		polarCalls.push(path);
		return Response.json(polarSubscription);
	}) as PolarFetch,
});

let orgCounter = 0;
async function newOrg() {
	orgCounter += 1;
	return (await createOrgForUser(db, `user_hook_${orgCounter}`, `Hook ${orgCounter}`)).org.id;
}

const stateOf = async (orgId: string) => {
	const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
	return row;
};
const planOf = async (orgId: string, now = T0 + DAY) => effectivePlan(await stateOf(orgId), now);

let seq = 0;
type SubOptions = {
	id?: string;
	orgId?: string;
	status?: string;
	product?: "pro" | "max" | string;
	periodEnd?: number;
	cancelAtPeriodEnd?: boolean;
	modifiedAt?: number;
	customerId?: string;
	externalId?: string | null;
	metadata?: Record<string, unknown>;
};
// A subscription as Polar sends it.
function subscription(o: SubOptions) {
	const product = o.product === "pro" || o.product === undefined ? POLAR.products.pro : o.product === "max" ? POLAR.products.max : o.product;
	return {
		id: o.id ?? "sub_1",
		status: o.status ?? "active",
		current_period_end: new Date(o.periodEnd ?? T0 + 30 * DAY).toISOString(),
		cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
		modified_at: new Date(o.modifiedAt ?? T0).toISOString(),
		created_at: new Date(T0).toISOString(),
		product_id: product,
		customer_id: o.customerId ?? "cus_1",
		customer: { id: o.customerId ?? "cus_1", external_id: o.externalId === undefined ? o.orgId : o.externalId },
		metadata: o.metadata ?? (o.orgId ? { org_id: o.orgId } : {}),
	};
}

type Delivery = { id?: string; type: string; data: unknown; secret?: string; timestamp?: number; signature?: string };
async function deliver({ id, type, data, secret = SECRET, timestamp, signature }: Delivery) {
	seq += 1;
	const webhookId = id ?? `evt_${seq}`;
	const ts = timestamp ?? Math.floor(Date.now() / 1000);
	const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
	const res = await app.request(
		"/webhooks/polar",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"webhook-id": webhookId,
				"webhook-timestamp": String(ts),
				"webhook-signature": signature ?? (await signWebhook(secret, webhookId, ts, body)),
			},
			body,
		},
		env,
	);
	return { res, id: webhookId, json: (await res.json()) as { ok?: boolean; outcome?: string; error?: { code: string } } };
}

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = { CLERK_SECRET_KEY: "x", GOOGLE_GENERATIVE_AI_API_KEY: "x", DB: testD1.d1, POLAR_WEBHOOK_SECRET: SECRET, POLAR_ACCESS_TOKEN: "t" } as unknown as Env;
	db = getDb(testD1.d1);
});
afterAll(() => dispose());
beforeEach(() => {
	polarCalls = [];
	polarSubscription = {};
});

describe("verifyWebhook", () => {
	const now = Date.now();
	const ts = String(Math.floor(now / 1000));

	it("accepts a good signature, also among several", async () => {
		const sig = await signWebhook(SECRET, "evt", Number(ts), "{}");
		expect(await verifyWebhook(SECRET, { id: "evt", timestamp: ts, signature: sig }, "{}", now)).toBe("ok");
		expect(await verifyWebhook(SECRET, { id: "evt", timestamp: ts, signature: `v1,AAAA ${sig}` }, "{}", now)).toBe("ok");
	});

	it("rejects a wrong secret, a changed body, missing headers and garbage", async () => {
		const sig = await signWebhook(SECRET, "evt", Number(ts), "{}");
		expect(await verifyWebhook("other", { id: "evt", timestamp: ts, signature: sig }, "{}", now)).toBe("bad_signature");
		expect(await verifyWebhook(SECRET, { id: "evt", timestamp: ts, signature: sig }, "{ }", now)).toBe("bad_signature");
		expect(await verifyWebhook(SECRET, { id: undefined, timestamp: ts, signature: sig }, "{}", now)).toBe("bad_signature");
		expect(await verifyWebhook(SECRET, { id: "evt", timestamp: ts, signature: "v1,!!!not-base64" }, "{}", now)).toBe("bad_signature");
		expect(await verifyWebhook(SECRET, { id: "evt", timestamp: ts, signature: "v2,AAAA" }, "{}", now)).toBe("bad_signature");
	});

	it("rejects a timestamp more than 5 minutes off, in either direction", async () => {
		for (const offset of [-301, 301]) {
			const old = String(Math.floor(now / 1000) + offset);
			const sig = await signWebhook(SECRET, "evt", Number(old), "{}");
			expect(await verifyWebhook(SECRET, { id: "evt", timestamp: old, signature: sig }, "{}", now)).toBe("stale_timestamp");
		}
	});
});

describe("POST /webhooks/polar: requests", () => {
	it("rejects a bad signature with 401 and changes nothing", async () => {
		const orgId = await newOrg();
		const { res, id } = await deliver({
			type: "subscription.created",
			data: subscription({ orgId }),
			signature: "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		});
		expect(res.status).toBe(401);
		expect(await planOf(orgId)).toBe("free");
		expect(await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))).toHaveLength(0);
	});

	it("rejects a signature made with another secret", async () => {
		const orgId = await newOrg();
		const { res } = await deliver({ type: "subscription.created", data: subscription({ orgId }), secret: "someone else" });
		expect(res.status).toBe(401);
		expect(await planOf(orgId)).toBe("free");
	});

	it("rejects a stale timestamp even when it is signed correctly", async () => {
		const orgId = await newOrg();
		const { res, json } = await deliver({
			type: "subscription.created",
			data: subscription({ orgId }),
			timestamp: Math.floor(Date.now() / 1000) - 10 * 60,
		});
		expect(res.status).toBe(401);
		expect(json.error?.code).toBe("stale_timestamp");
		expect(await planOf(orgId)).toBe("free");
	});

	it("answers 503 when the webhook secret is not configured", async () => {
		const res = await app.request("/webhooks/polar", { method: "POST", body: "{}" }, { ...env, POLAR_WEBHOOK_SECRET: undefined } as unknown as Env);
		expect(res.status).toBe(503);
	});

	it("answers 400 for a body that is not an event", async () => {
		const { res } = await deliver({ type: "subscription.created", data: { nothing: true } });
		expect(res.status).toBe(400);
	});

	it("answers 202 to an event type it does not handle, and does not handle it again", async () => {
		const first = await deliver({ id: "evt_unknown", type: "customer.updated", data: {} });
		expect(first.res.status).toBe(202);
		const second = await deliver({ id: "evt_unknown", type: "customer.updated", data: {} });
		expect(second.json.outcome).toBe("duplicate");
	});
});

describe("POST /webhooks/polar: plan transitions", () => {
	it("create: a new active Pro subscription gives the Pro plan", async () => {
		const orgId = await newOrg();
		const { res, json } = await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		expect(res.status).toBe(200);
		expect(json.outcome).toBe("applied");
		const org = await stateOf(orgId);
		expect(org).toMatchObject({
			plan: "pro",
			subscriptionStatus: "active",
			polarSubscriptionId: "sub_1",
			polarCustomerId: "cus_1",
			cancelAtPeriodEnd: false,
		});
		expect(org.currentPeriodEnd).toBe(T0 + 30 * DAY);
		expect(await planOf(orgId)).toBe("pro");
	});

	it("upgrade: the same subscription moved to the Max product gives Max", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.updated", data: subscription({ orgId, product: "max", modifiedAt: T0 + 1000 }) });
		expect(await planOf(orgId)).toBe("max");
	});

	it("downgrade: the same subscription moved back to Pro gives Pro", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId, product: "max" }) });
		await deliver({ type: "subscription.updated", data: subscription({ orgId, product: "pro", modifiedAt: T0 + 1000 }) });
		expect(await planOf(orgId)).toBe("pro");
	});

	it("cancel at period end: keeps the plan until the period is over, then drops to Free", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({
			type: "subscription.canceled",
			data: subscription({ orgId, cancelAtPeriodEnd: true, modifiedAt: T0 + 1000 }),
		});
		expect(await stateOf(orgId)).toMatchObject({ cancelAtPeriodEnd: true, subscriptionStatus: "active" });
		expect(await planOf(orgId, T0 + 29 * DAY)).toBe("pro");
		expect(await planOf(orgId, T0 + 31 * DAY)).toBe("free");
	});

	it("uncancel: clears the pending cancellation", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.canceled", data: subscription({ orgId, cancelAtPeriodEnd: true, modifiedAt: T0 + 1000 }) });
		await deliver({ type: "subscription.uncanceled", data: subscription({ orgId, modifiedAt: T0 + 2000 }) });
		expect(await stateOf(orgId)).toMatchObject({ cancelAtPeriodEnd: false, plan: "pro" });
	});

	it("renew: a new period end extends the plan past the old one", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		expect(await planOf(orgId, T0 + 40 * DAY)).toBe("free");
		await deliver({
			type: "subscription.updated",
			data: subscription({ orgId, periodEnd: T0 + 60 * DAY, modifiedAt: T0 + 30 * DAY }),
		});
		expect(await planOf(orgId, T0 + 40 * DAY)).toBe("pro");
	});

	it("payment failure: past_due keeps the plan while Polar retries the payment", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.past_due", data: subscription({ orgId, status: "past_due", modifiedAt: T0 + 1000 }) });
		expect(await stateOf(orgId)).toMatchObject({ subscriptionStatus: "past_due" });
		expect(await planOf(orgId)).toBe("pro");
	});

	it("revoke: drops the company to Free at once", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.revoked", data: subscription({ orgId, status: "canceled", modifiedAt: T0 + 1000 }) });
		expect(await stateOf(orgId)).toMatchObject({ plan: "free", subscriptionStatus: "canceled" });
		expect(await planOf(orgId)).toBe("free");
	});

	it("revoke: forces the canceled state even if the payload still says active", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.revoked", data: subscription({ orgId, status: "active", modifiedAt: T0 + 1000 }) });
		expect(await planOf(orgId)).toBe("free");
	});

	it("never grants an incomplete subscription, and grants it once it becomes active", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId, status: "incomplete" }) });
		expect(await stateOf(orgId)).toMatchObject({ subscriptionStatus: "incomplete" });
		expect(await planOf(orgId)).toBe("free");
		await deliver({ type: "subscription.active", data: subscription({ orgId, modifiedAt: T0 + 1000 }) });
		expect(await planOf(orgId)).toBe("pro");
	});

	it("refund: revokes when the refunded order's subscription is no longer active", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		polarSubscription = subscription({ orgId, status: "canceled", modifiedAt: T0 + 5000 });
		const { json } = await deliver({ type: "order.refunded", data: { id: "ord_1", subscription_id: "sub_1", status: "refunded" } });
		expect(json.outcome).toBe("applied");
		expect(polarCalls).toEqual(["/subscriptions/sub_1"]);
		expect(await planOf(orgId)).toBe("free");
	});

	it("refund: ignores a partial refund that leaves the subscription active", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		polarSubscription = subscription({ orgId, status: "active", modifiedAt: T0 + 5000 });
		const { json } = await deliver({ type: "order.refunded", data: { id: "ord_2", subscription_id: "sub_1", status: "partially_refunded" } });
		expect(json.outcome).toBe("ignored");
		expect(await planOf(orgId)).toBe("pro");
	});

	it("refund: ignores orders of other subscriptions and orders without one", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		expect((await deliver({ type: "order.refunded", data: { id: "ord_3", subscription_id: "sub_other" } })).json.outcome).toBe("ignored");
		expect((await deliver({ type: "order.refunded", data: { id: "ord_4" } })).json.outcome).toBe("ignored");
		expect(polarCalls).toEqual([]);
		expect(await planOf(orgId)).toBe("pro");
	});
});

describe("POST /webhooks/polar: ordering, repeats and matching", () => {
	it("a late updated event after revoked does not grant the plan again (B1)", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ orgId }) });
		await deliver({ type: "subscription.revoked", data: subscription({ orgId, status: "canceled", modifiedAt: T0 + 3000 }) });
		const late = await deliver({ type: "subscription.updated", data: subscription({ orgId, status: "active", modifiedAt: T0 + 2000 }) });
		expect(late.res.status).toBe(200);
		expect(late.json.outcome).toBe("ignored");
		expect(await planOf(orgId)).toBe("free");
		expect(await stateOf(orgId)).toMatchObject({ subscriptionStatus: "canceled" });
	});

	it("applies out-of-order events in the order Polar made them", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.updated", data: subscription({ orgId, product: "max", modifiedAt: T0 + 2000 }) });
		await deliver({ type: "subscription.created", data: subscription({ orgId, product: "pro", modifiedAt: T0 }) });
		expect(await planOf(orgId)).toBe("max");
	});

	it("handles a repeated delivery once", async () => {
		const orgId = await newOrg();
		const first = await deliver({ id: "evt_dup", type: "subscription.created", data: subscription({ orgId }) });
		expect(first.json.outcome).toBe("applied");
		// Change the state by hand: a second handling would overwrite it.
		await db.update(organizations).set({ plan: "max" }).where(eq(organizations.id, orgId));
		const second = await deliver({ id: "evt_dup", type: "subscription.created", data: subscription({ orgId }) });
		expect(second.res.status).toBe(200);
		expect(second.json.outcome).toBe("duplicate");
		expect((await stateOf(orgId)).plan).toBe("max");
	});

	it("answers 503 for a company it cannot find, without recording it, so Polar retries", async () => {
		const sub = subscription({ id: "sub_lost", externalId: "no-such-org", customerId: "cus_lost", metadata: { org_id: "no-such-org" } });
		const first = await deliver({ id: "evt_lost", type: "subscription.created", data: sub });
		expect(first.res.status).toBe(503);
		expect(await db.select().from(webhookEvents).where(eq(webhookEvents.id, "evt_lost"))).toHaveLength(0);

		// The company shows up (checkout metadata now matches), and the same event id is handled on the retry.
		const orgId = await newOrg();
		const retry = await deliver({ id: "evt_lost", type: "subscription.created", data: { ...sub, metadata: { org_id: orgId } } });
		expect(retry.res.status).toBe(200);
		expect(await planOf(orgId)).toBe("pro");
	});

	it("finds the company by external customer id when the metadata is missing", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ id: "sub_ext", orgId, metadata: {} }) });
		expect(await planOf(orgId)).toBe("pro");
	});

	it("finds the company by customer id, then by subscription id", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ id: "sub_a", orgId, customerId: "cus_a" }) });
		const byCustomer = await deliver({
			type: "subscription.updated",
			data: subscription({ id: "sub_a", externalId: null, metadata: {}, customerId: "cus_a", product: "max", modifiedAt: T0 + 1000 }),
		});
		expect(byCustomer.json.outcome).toBe("applied");
		const bySubscription = await deliver({
			type: "subscription.updated",
			data: subscription({ id: "sub_a", externalId: null, metadata: {}, customerId: "cus_changed", product: "pro", modifiedAt: T0 + 2000 }),
		});
		expect(bySubscription.json.outcome).toBe("applied");
		expect(await planOf(orgId)).toBe("pro");
	});

	it("ignores events of an older subscription while the current one is active", async () => {
		const orgId = await newOrg();
		await deliver({ type: "subscription.created", data: subscription({ id: "sub_old", orgId }) });
		await deliver({ type: "subscription.revoked", data: subscription({ id: "sub_old", orgId, status: "canceled", modifiedAt: T0 + 1000 }) });
		await deliver({ type: "subscription.created", data: subscription({ id: "sub_new", orgId, product: "max", modifiedAt: T0 + 2000 }) });
		expect(await stateOf(orgId)).toMatchObject({ polarSubscriptionId: "sub_new", plan: "max" });

		const stale = await deliver({ type: "subscription.revoked", data: subscription({ id: "sub_old", orgId, status: "canceled", modifiedAt: T0 + 3000 }) });
		expect(stale.json.outcome).toBe("ignored");
		const stale2 = await deliver({ type: "subscription.updated", data: subscription({ id: "sub_old", orgId, modifiedAt: T0 + 4000 }) });
		expect(stale2.json.outcome).toBe("ignored");
		expect(await stateOf(orgId)).toMatchObject({ polarSubscriptionId: "sub_new", plan: "max" });
		expect(await planOf(orgId)).toBe("max");
	});

	it("answers 503 for a product it does not sell, instead of guessing a plan", async () => {
		const orgId = await newOrg();
		const { res } = await deliver({ type: "subscription.created", data: subscription({ orgId, product: "prod_unknown" }) });
		expect(res.status).toBe(503);
		expect(await planOf(orgId)).toBe("free");
	});
});
