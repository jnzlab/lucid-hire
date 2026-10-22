import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { takeSlot } from "./candidates.ts";
import { type Db, getDb } from "./db/client.ts";
import { jobs, organizations, usageCounters } from "./db/schema.ts";
import { createJob } from "./jobs.ts";
import { createOrgForUser } from "./orgs.ts";
import { type PlanState, RENEWAL_GRACE_MS, effectivePlan, limitSql } from "./plan-state.ts";
import { createTestD1 } from "./test/d1.ts";
import { hourPeriod, monthPeriod, readUnits, returnUnit, secondsToNextHour, takeUnit } from "./usage.ts";

// Dozens of requests against a real D1 per test.
vi.setConfig({ testTimeout: 30_000 });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("effectivePlan", () => {
	const now = Date.UTC(2026, 9, 22, 12);
	const paid = (over: Partial<PlanState>): PlanState => ({
		plan: "pro",
		subscriptionStatus: "active",
		currentPeriodEnd: now + DAY,
		...over,
	});

	it("is free for a company that never paid", () => {
		expect(effectivePlan({ plan: "free", subscriptionStatus: null, currentPeriodEnd: null }, now)).toBe("free");
	});

	it("gives the paid plan while the subscription is active, trialing or past due and the period is not over", () => {
		for (const subscriptionStatus of ["active", "trialing", "past_due"]) {
			expect(effectivePlan(paid({ subscriptionStatus }), now)).toBe("pro");
		}
		expect(effectivePlan(paid({ plan: "max" }), now)).toBe("max");
	});

	it("never grants incomplete, unpaid, canceled or unknown statuses", () => {
		for (const subscriptionStatus of ["incomplete", "incomplete_expired", "unpaid", "canceled", null]) {
			expect(effectivePlan(paid({ subscriptionStatus }), now)).toBe("free");
		}
	});

	it("drops to free once the paid period and its renewal grace have ended, whatever the status says", () => {
		expect(effectivePlan(paid({ currentPeriodEnd: now - RENEWAL_GRACE_MS - 1 }), now)).toBe("free");
		expect(effectivePlan(paid({ currentPeriodEnd: now - RENEWAL_GRACE_MS }), now)).toBe("free");
		expect(effectivePlan(paid({ currentPeriodEnd: null }), now)).toBe("free");
	});

	it("keeps a renewing plan through the grace, while Polar's renewal webhook is on the way", () => {
		expect(effectivePlan(paid({ currentPeriodEnd: now - 1 }), now)).toBe("pro");
		expect(effectivePlan(paid({ currentPeriodEnd: now - RENEWAL_GRACE_MS + 1 }), now)).toBe("pro");
	});

	it("ends a plan set to cancel with its period, with no grace", () => {
		expect(effectivePlan(paid({ currentPeriodEnd: now + 1, cancelAtPeriodEnd: true }), now)).toBe("pro");
		expect(effectivePlan(paid({ currentPeriodEnd: now, cancelAtPeriodEnd: true }), now)).toBe("free");
	});

	it("treats an unknown stored plan as free", () => {
		expect(effectivePlan(paid({ plan: "enterprise" }), now)).toBe("free");
	});
});

describe("usage periods", () => {
	it("names the UTC month and hour", () => {
		const at = Date.UTC(2026, 9, 22, 14, 59, 59);
		expect(monthPeriod(at)).toBe("2026-10");
		expect(hourPeriod(at)).toBe("2026-10-22T14");
	});

	it("counts the seconds to the next UTC hour for Retry-After", () => {
		expect(secondsToNextHour(Date.UTC(2026, 9, 22, 14, 59, 0))).toBe(60);
		expect(secondsToNextHour(Date.UTC(2026, 9, 22, 15, 0, 0))).toBe(3600);
	});
});

let db: Db;
let env: Env;
let dispose: () => Promise<void>;
let aiBurstAllowed = true;

const verify: SessionVerifier = async (token) => ({ userId: token.slice(2) });
const app = createApp({
	verifySession: verify,
	enhanceDescription: async () => ({ value: "Rewritten", inputTokens: 1, outputTokens: 1 }),
});

let orgCounter = 0;
// A fresh company with one admin, so each test has its own counters.
async function newOrg(over: Partial<typeof organizations.$inferInsert> = {}) {
	orgCounter += 1;
	const userId = `user_limits_${orgCounter}`;
	const { org } = await createOrgForUser(db, userId, `Limits ${orgCounter}`);
	if (Object.keys(over).length > 0) await db.update(organizations).set(over).where(eq(organizations.id, org.id));
	return { orgId: org.id, userId };
}

const future = () => Date.now() + 30 * DAY;

async function call(user: string, method: string, path: string, body?: unknown) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const res = await app.request(
		path,
		{
			method,
			headers: { authorization: `Bearer t:${user}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		env,
		ctx as unknown as ExecutionContext,
	);
	await Promise.all(pending);
	return res;
}

const newJob = (user: string, title = "Role") => call(user, "POST", "/jobs", { title, description: "Needs things" });

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		DB: testD1.d1,
		AI_RATE_LIMIT: { limit: async () => ({ success: aiBurstAllowed }) },
	} as unknown as Env;
	db = getDb(testD1.d1);
});

afterAll(() => dispose());

beforeEach(() => {
	aiBurstAllowed = true;
});

describe("the monthly job allowance", () => {
	it("lets a free company create 10 jobs and refuses the 11th with an upgrade link", async () => {
		const { orgId, userId } = await newOrg();
		for (let i = 0; i < 10; i += 1) expect((await newJob(userId)).status).toBe(201);

		const res = await newJob(userId);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: {
				code: "plan_limit",
				message: "You've used all 10 new jobs this month. Deleting a job does not give the slot back.",
				upgradeUrl: "/dashboard/settings#plan",
			},
		});
		expect(await readUnits(db, orgId, "jobs_month", monthPeriod())).toBe(10);
		expect(await db.select().from(jobs).where(eq(jobs.orgId, orgId))).toHaveLength(10);
	});

	it("does not give the slot back when a job is deleted", async () => {
		const { userId } = await newOrg();
		const created = [];
		for (let i = 0; i < 10; i += 1) created.push((await (await newJob(userId)).json()) as { job: { id: string } });
		expect((await call(userId, "DELETE", `/jobs/${created[0].job.id}`)).status).toBe(204);
		expect((await newJob(userId)).status).toBe(403);
	});

	it("lets exactly 10 of 14 simultaneous requests through", async () => {
		const { orgId, userId } = await newOrg();
		const responses = await Promise.all(Array.from({ length: 14 }, () => newJob(userId)));
		expect(responses.filter((res) => res.status === 201)).toHaveLength(10);
		expect(responses.filter((res) => res.status === 403)).toHaveLength(4);
		expect(await db.select().from(jobs).where(eq(jobs.orgId, orgId))).toHaveLength(10);
	});

	it("gives Pro 20 a month and Max no limit, still counting them", async () => {
		const pro = await newOrg({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: future() });
		for (let i = 0; i < 20; i += 1) expect((await newJob(pro.userId)).status).toBe(201);
		const refused = await newJob(pro.userId);
		expect(refused.status).toBe(403);
		expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining("all 20 new jobs") } });

		const max = await newOrg({ plan: "max", subscriptionStatus: "active", currentPeriodEnd: future() });
		for (let i = 0; i < 22; i += 1) expect((await newJob(max.userId)).status).toBe(201);
		expect(await readUnits(db, max.orgId, "jobs_month", monthPeriod())).toBe(22);
	});

	it("falls back to the free allowance once the paid period has ended", async () => {
		const { userId } = await newOrg({ plan: "max", subscriptionStatus: "active", currentPeriodEnd: Date.now() - RENEWAL_GRACE_MS - 1000 });
		for (let i = 0; i < 10; i += 1) expect((await newJob(userId)).status).toBe(201);
		expect((await newJob(userId)).status).toBe(403);
	});

	it("starts a new month with a new counter", async () => {
		const { orgId } = await newOrg();
		const limit = limitSql(orgId, (plan) => plan.jobsPerMonth);
		for (let i = 0; i < 10; i += 1) expect(await takeUnit(db, orgId, "jobs_month", "2026-09", limit)).toBe(true);
		expect(await takeUnit(db, orgId, "jobs_month", "2026-09", limit)).toBe(false);
		expect(await takeUnit(db, orgId, "jobs_month", "2026-10", limit)).toBe(true);
	});

	it("returns a unit when asked, and never goes below zero", async () => {
		const { orgId } = await newOrg();
		const limit = limitSql(orgId, (plan) => plan.jobsPerMonth);
		await takeUnit(db, orgId, "jobs_month", "2026-10", limit);
		await returnUnit(db, orgId, "jobs_month", "2026-10");
		await returnUnit(db, orgId, "jobs_month", "2026-10");
		expect(await readUnits(db, orgId, "jobs_month", "2026-10")).toBe(0);
	});

	it("never creates a job it did not count", async () => {
		const { orgId, userId } = await newOrg();
		await createJob(db, orgId, userId, { title: "One", description: "x", status: "draft" });
		expect(await readUnits(db, orgId, "jobs_month", monthPeriod())).toBe(1);
		expect(await db.select().from(jobs).where(eq(jobs.orgId, orgId))).toHaveLength(1);
	});
});

describe("the CV limit per job", () => {
	async function openJob(orgId: string, userId: string, cvCount: number) {
		const job = await createJob(db, orgId, userId, { title: "Role", description: "x", status: "open" });
		if (job === "limit") throw new Error("job allowance reached");
		await db.update(jobs).set({ cvCount }).where(eq(jobs.id, job.id));
		return job.id;
	}

	it("allows 10 on Free, 100 on Pro and 1,000 on Max, in one statement", async () => {
		const free = await newOrg();
		expect(await takeSlot(db, free.orgId, await openJob(free.orgId, free.userId, 9))).toEqual({ ok: true });
		expect(await takeSlot(db, free.orgId, await openJob(free.orgId, free.userId, 10))).toEqual({
			ok: false,
			reason: "cv_limit",
		});

		const pro = await newOrg({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: future() });
		expect(await takeSlot(db, pro.orgId, await openJob(pro.orgId, pro.userId, 99))).toEqual({ ok: true });
		expect((await takeSlot(db, pro.orgId, await openJob(pro.orgId, pro.userId, 100))).ok).toBe(false);

		const max = await newOrg({ plan: "max", subscriptionStatus: "active", currentPeriodEnd: future() });
		expect(await takeSlot(db, max.orgId, await openJob(max.orgId, max.userId, 999))).toEqual({ ok: true });
		expect((await takeSlot(db, max.orgId, await openJob(max.orgId, max.userId, 1000))).ok).toBe(false);
	});

	it("uses the free limit for a lapsed or unpaid subscription", async () => {
		for (const over of [
			{ plan: "pro" as const, subscriptionStatus: "active" as const, currentPeriodEnd: Date.now() - RENEWAL_GRACE_MS - 1 },
			{ plan: "pro" as const, subscriptionStatus: "active" as const, currentPeriodEnd: Date.now() - 1, cancelAtPeriodEnd: true },
			{ plan: "pro" as const, subscriptionStatus: "incomplete" as const, currentPeriodEnd: future() },
			{ plan: "max" as const, subscriptionStatus: "canceled" as const, currentPeriodEnd: future() },
		]) {
			const { orgId, userId } = await newOrg(over);
			expect((await takeSlot(db, orgId, await openJob(orgId, userId, 10))).ok).toBe(false);
		}
	});
});

describe("the AI allowance per hour", () => {
	const enhance = (user: string) => call(user, "POST", "/jobs/enhance", { description: "rough notes" });

	it("answers 429 with Retry-After once the hour's allowance is spent", async () => {
		const { orgId, userId } = await newOrg();
		await db.insert(usageCounters).values({ orgId, metric: "ai_hour", period: hourPeriod(), count: 29 });

		expect((await enhance(userId)).status).toBe(200);
		const res = await enhance(userId);
		expect(res.status).toBe(429);
		const retryAfter = Number(res.headers.get("retry-after"));
		expect(retryAfter).toBeGreaterThanOrEqual(1);
		expect(retryAfter).toBeLessThanOrEqual(3600);
		expect(await res.json()).toEqual({
			error: {
				code: "plan_limit",
				message: "You've used all 30 AI requests for this hour. They reset at the top of the hour.",
				upgradeUrl: "/dashboard/settings#plan",
			},
		});
		expect(await readUnits(db, orgId, "ai_hour", hourPeriod())).toBe(30);
	});

	it("gives Pro 150 an hour", async () => {
		const { orgId, userId } = await newOrg({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: future() });
		await db.insert(usageCounters).values({ orgId, metric: "ai_hour", period: hourPeriod(), count: 149 });
		expect((await enhance(userId)).status).toBe(200);
		expect((await enhance(userId)).status).toBe(429);
	});

	it("keeps the per-minute burst guard, which does not spend the hourly allowance", async () => {
		const { orgId, userId } = await newOrg();
		aiBurstAllowed = false;
		const res = await enhance(userId);
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: { code: "rate_limited" } });
		expect(await readUnits(db, orgId, "ai_hour", hourPeriod())).toBe(0);
	});
});
