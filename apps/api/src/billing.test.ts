import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import type { UserDirectory } from "./clerk.ts";
import { POLAR } from "./config.ts";
import { type Db, getDb } from "./db/client.ts";
import { jobs, members, organizations, usageCounters } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { hourPeriod, monthPeriod } from "./usage.ts";
import type { PolarFetch } from "./polar.ts";
import { createTestD1 } from "./test/d1.ts";
import { RENEWAL_GRACE_MS } from "./plan-state.ts";

vi.setConfig({ testTimeout: 30_000 });

type PolarCall = { path: string; method: string; body: unknown };
let polarCalls: PolarCall[];
let polarReply: (call: PolarCall) => { status: number; json: unknown };

const polar: PolarFetch = async (path, init = {}) => {
	const call = { path, method: init.method ?? "GET", body: init.body };
	polarCalls.push(call);
	const { status, json } = polarReply(call);
	return Response.json(json, { status });
};
const directory: UserDirectory = async (_env, ids) =>
	new Map(ids.map((id) => [id, { name: "Ada Lovelace", email: `${id}@example.com`, imageUrl: null }]));
const verify: SessionVerifier = async (token) => ({ userId: token.slice(2) });
const app = createApp({ verifySession: verify, polar: () => polar, directory });

let db: Db;
let env: Env;
let dispose: () => Promise<void>;
let counter = 0;

const DAY = 86_400_000;
const future = () => Date.now() + 30 * DAY;

// A company with an admin `<name>_admin` and a member `<name>_member`.
async function newOrg(over: Partial<typeof organizations.$inferInsert> = {}) {
	counter += 1;
	const admin = `billing_admin_${counter}`;
	const member = `billing_member_${counter}`;
	const { org } = await createOrgForUser(db, admin, `Billing ${counter}`);
	await db.insert(members).values({ orgId: org.id, userId: member, role: "member" });
	if (Object.keys(over).length > 0) await db.update(organizations).set(over).where(eq(organizations.id, org.id));
	return { orgId: org.id, admin, member };
}

const paying = (plan: "pro" | "max", over: Partial<typeof organizations.$inferInsert> = {}) => ({
	plan,
	polarCustomerId: "cus_1",
	polarSubscriptionId: "sub_1",
	subscriptionStatus: "active" as const,
	currentPeriodEnd: future(),
	...over,
});

async function call(user: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	return app.request(
		path,
		{
			method,
			headers: { authorization: `Bearer t:${user}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		env,
	);
}

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = { CLERK_SECRET_KEY: "x", DB: testD1.d1 } as unknown as Env;
	db = getDb(testD1.d1);
});
afterAll(() => dispose());
beforeEach(() => {
	polarCalls = [];
	polarReply = () => ({ status: 200, json: {} });
});

describe("GET /billing", () => {
	it("reports a free company's plan and usage, for admins and members", async () => {
		const { orgId, admin, member } = await newOrg();
		await db.insert(usageCounters).values([
			{ orgId, metric: "jobs_month", period: monthPeriod(), count: 4 },
			{ orgId, metric: "ai_hour", period: hourPeriod(), count: 7 },
		]);
		await db.insert(jobs).values([
			{ id: "j1", orgId, title: "Quiet role", description: "x", createdBy: admin, cvCount: 2 },
			{ id: "j2", orgId, title: "Busy role", description: "x", createdBy: admin, cvCount: 9 },
		]);

		for (const [user, isAdmin] of [[admin, true], [member, false]] as const) {
			const res = await call(user, "GET", "/billing");
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(await res.json()).toEqual({
				plan: "free",
				effectivePlan: "free",
				status: null,
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				usage: {
					jobsThisMonth: 4,
					jobsLimit: 10,
					busiestJob: { id: "j2", title: "Busy role", cvCount: 9 },
					cvLimit: 10,
					aiThisHour: 7,
					aiLimit: 30,
				},
				isAdmin,
			});
		}
	});

	it("shows Max with no job limit, and null for a company without any CV yet", async () => {
		const { admin } = await newOrg(paying("max"));
		const body = (await (await call(admin, "GET", "/billing")).json()) as Record<string, any>;
		expect(body).toMatchObject({ plan: "max", effectivePlan: "max", status: "active", cancelAtPeriodEnd: false });
		expect(body.usage).toMatchObject({ jobsLimit: null, cvLimit: 1000, aiLimit: 600, busiestJob: null });
		expect(typeof body.currentPeriodEnd).toBe("string");
	});

	it("shows the free limits once a paid period and its renewal grace have ended, while still naming the stored plan", async () => {
		const { admin } = await newOrg(paying("pro", { currentPeriodEnd: Date.now() - RENEWAL_GRACE_MS - 1000 }));
		const body = (await (await call(admin, "GET", "/billing")).json()) as Record<string, any>;
		expect(body).toMatchObject({ plan: "pro", effectivePlan: "free" });
		expect(body.usage.cvLimit).toBe(10);
	});

	it("keeps a renewing plan while its renewal webhook is on the way", async () => {
		// Polar charges first and sends the webhook after: a period that ended a minute ago is still paid for.
		const { admin } = await newOrg(paying("pro", { currentPeriodEnd: Date.now() - 60_000 }));
		const body = (await (await call(admin, "GET", "/billing")).json()) as Record<string, any>;
		expect(body).toMatchObject({ plan: "pro", effectivePlan: "pro" });
		expect(body.usage.cvLimit).toBe(100);
	});

	it("ends a plan set to cancel with its period, with no renewal grace", async () => {
		const { admin } = await newOrg(paying("pro", { currentPeriodEnd: Date.now() - 60_000, cancelAtPeriodEnd: true }));
		const body = (await (await call(admin, "GET", "/billing")).json()) as Record<string, any>;
		expect(body).toMatchObject({ plan: "pro", effectivePlan: "free" });
	});

	it("needs a session and a company", async () => {
		expect((await app.request("/billing", {}, env)).status).toBe(401);
		expect((await call("nobody", "GET", "/billing")).status).toBe(403);
	});
});

describe("POST /billing/checkout", () => {
	it("opens a Polar checkout for a free company, tied to the company", async () => {
		const { orgId, admin } = await newOrg();
		polarReply = () => ({ status: 201, json: { url: "https://sandbox.polar.sh/checkout/abc" } });

		const res = await call(admin, "POST", "/billing/checkout", { plan: "max" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/abc" });
		expect(polarCalls).toEqual([
			{
				path: "/checkouts/",
				method: "POST",
				body: {
					products: [POLAR.products.max],
					external_customer_id: orgId,
					customer_email: `${admin}@example.com`,
					metadata: { org_id: orgId },
					success_url: "https://lucidhire.io/dashboard/settings/billing?checkout=success",
				},
			},
		]);
	});

	it("sends people back to localhost when they came from there", async () => {
		const { admin } = await newOrg();
		polarReply = () => ({ status: 201, json: { url: "https://sandbox.polar.sh/checkout/abc" } });
		await call(admin, "POST", "/billing/checkout", { plan: "pro" }, { origin: "http://localhost:5173" });
		expect((polarCalls[0].body as { success_url: string }).success_url).toBe(
			"http://localhost:5173/dashboard/settings/billing?checkout=success",
		);
		await call(admin, "POST", "/billing/checkout", { plan: "pro" }, { origin: "https://evil.example" });
		expect((polarCalls[1].body as { success_url: string }).success_url).toMatch(/^https:\/\/lucidhire\.io\//);
	});

	it("is for admins only", async () => {
		const { member } = await newOrg();
		const res = await call(member, "POST", "/billing/checkout", { plan: "pro" });
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
		expect(polarCalls).toEqual([]);
	});

	it("rejects a plan that is not for sale", async () => {
		const { admin } = await newOrg();
		for (const plan of ["free", "enterprise", undefined]) {
			expect((await call(admin, "POST", "/billing/checkout", { plan })).status).toBe(400);
		}
		expect(polarCalls).toEqual([]);
	});

	it("changes the existing subscription instead of opening a second checkout (B2)", async () => {
		const { admin } = await newOrg(paying("pro"));
		const res = await call(admin, "POST", "/billing/checkout", { plan: "max" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ changed: true, plan: "max" });
		expect(polarCalls).toEqual([
			{ path: "/subscriptions/sub_1", method: "PATCH", body: { product_id: POLAR.products.max, proration_behavior: "invoice" } },
		]);
	});

	it("never opens a second checkout while the stored subscription still says active, however late its renewal is", async () => {
		// Polar may still be renewing it; a new checkout now would bill the company twice.
		const { admin } = await newOrg(paying("pro", { currentPeriodEnd: Date.now() - RENEWAL_GRACE_MS - 60_000 }));
		const res = await call(admin, "POST", "/billing/checkout", { plan: "max" });
		expect(await res.json()).toEqual({ changed: true, plan: "max" });
		expect(polarCalls.map(({ path }) => path)).toEqual(["/subscriptions/sub_1"]);
	});

	it("will not change to the plan the company is already on, or while payment is overdue or a cancellation is pending", async () => {
		const same = await newOrg(paying("pro"));
		expect(await (await call(same.admin, "POST", "/billing/checkout", { plan: "pro" })).json()).toMatchObject({ error: { code: "same_plan" } });

		const overdue = await newOrg(paying("pro", { subscriptionStatus: "past_due" }));
		expect(await (await call(overdue.admin, "POST", "/billing/checkout", { plan: "max" })).json()).toMatchObject({
			error: { code: "payment_overdue" },
		});

		const ending = await newOrg(paying("pro", { cancelAtPeriodEnd: true }));
		expect(await (await call(ending.admin, "POST", "/billing/checkout", { plan: "max" })).json()).toMatchObject({
			error: { code: "cancel_pending" },
		});
		expect(polarCalls).toEqual([]);
	});

	it("opens a new checkout for a company whose subscription ended", async () => {
		const { admin } = await newOrg(paying("pro", { plan: "free", subscriptionStatus: "canceled" }));
		polarReply = () => ({ status: 201, json: { url: "https://sandbox.polar.sh/checkout/new" } });
		const res = await call(admin, "POST", "/billing/checkout", { plan: "pro" });
		expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/new" });
		expect(polarCalls[0].path).toBe("/checkouts/");
	});

	it("answers 502 in plain words when Polar fails, without leaking its error", async () => {
		const { admin } = await newOrg();
		polarReply = () => ({ status: 500, json: { detail: "secret internals" } });
		const res = await call(admin, "POST", "/billing/checkout", { plan: "pro" });
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("billing_unavailable");
		expect(text).not.toContain("secret internals");

		const paid = await newOrg(paying("pro"));
		const changed = await call(paid.admin, "POST", "/billing/checkout", { plan: "max" });
		expect(changed.status).toBe(502);
	});
});

describe("POST /billing/portal", () => {
	it("opens the customer portal for the company's Polar customer", async () => {
		const { orgId, admin } = await newOrg(paying("pro"));
		polarReply = () => ({ status: 201, json: { customer_portal_url: "https://sandbox.polar.sh/portal/xyz" } });
		const res = await call(admin, "POST", "/billing/portal");
		expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/portal/xyz" });
		expect(polarCalls).toEqual([{ path: "/customer-sessions/", method: "POST", body: { external_customer_id: orgId } }]);
	});

	it("is for admins only", async () => {
		const { member } = await newOrg(paying("pro"));
		expect((await call(member, "POST", "/billing/portal")).status).toBe(403);
		expect(polarCalls).toEqual([]);
	});

	it("says there is nothing to manage before the first payment", async () => {
		const { admin } = await newOrg();
		const res = await call(admin, "POST", "/billing/portal");
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "no_billing" } });
	});

	it("answers 502 when Polar fails", async () => {
		const { admin } = await newOrg(paying("pro"));
		polarReply = () => ({ status: 500, json: {} });
		expect((await call(admin, "POST", "/billing/portal")).status).toBe(502);
	});
});
