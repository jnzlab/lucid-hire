import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs } from "./db/schema.ts";
import { getOverview } from "./overview.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let dispose: () => Promise<void>;
let spriteId: string;
let emptyId: string;
let acmeId: string;

const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};
const app = createApp({ verifySession: verify });

// A fixed clock: Thursday 22 Oct 2026, noon UTC. Last month is September, the 30-day windows start 22 Sep.
const NOW = new Date("2026-10-22T12:00:00Z");
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs);

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = { CLERK_SECRET_KEY: "x", GOOGLE_GENERATIVE_AI_API_KEY: "x", DB: testD1.d1 } as unknown as Env;
	db = getDb(testD1.d1);
	spriteId = (await createOrgForUser(db, "user_sprite", "Sprite Labs")).org.id;
	emptyId = (await createOrgForUser(db, "user_empty", "Empty Co")).org.id;
	acmeId = (await createOrgForUser(db, "user_acme", "Acme")).org.id;
});

afterAll(() => dispose());

const job = (id: string, orgId: string, fields: Partial<typeof jobs.$inferInsert> = {}) =>
	db.insert(jobs).values({ id, orgId, title: id, description: "d", createdBy: "u", ...fields });
let n = 0;
const cv = (jobId: string, orgId: string, fields: Partial<typeof candidates.$inferInsert> = {}) =>
	db.insert(candidates).values({
		id: `cand_${++n}`,
		orgId,
		jobId,
		fileKey: `k${n}`,
		fileName: `cv${n}.pdf`,
		fileSize: 1,
		createdBy: "u",
		...fields,
	});

describe("an empty company", () => {
	it("gets zeros, nulls and a zero-filled chart", async () => {
		const overview = await getOverview(db, emptyId, NOW);
		expect(overview.kpis).toEqual({
			activeRoles: { value: 0, change: 0 },
			cvsScreened: { value: 0, thisMonth: 0, lastMonth: 0 },
			avgTimeToShortlist: { hours: null, previousHours: null },
			topMatch: null,
		});
		expect(overview.funnel).toEqual({ received: 0, scored: 0, shortlisted: 0 });
		expect(overview.velocity.totals).toEqual(overview.funnel);
		expect(overview.velocity.days).toHaveLength(10);
		expect(overview.velocity.days[0]).toEqual({ date: "2026-10-13", uploaded: 0 });
		expect(overview.velocity.days[9]).toEqual({ date: "2026-10-22", uploaded: 0 });
		expect(overview.aiMix).toEqual({ scoring: 0, descriptionRewrites: 0, interviewQuestions: 0 });
		expect(overview.activity).toEqual([]);
	});
});

describe("a busy company", () => {
	beforeAll(async () => {
		await job("j_open_now", spriteId, { status: "open", title: "Open now", createdAt: at("2026-10-05T09:00:00Z") });
		await job("j_open_now2", spriteId, { status: "open", title: "Open too", createdAt: at("2026-10-10T09:00:00Z") });
		await job("j_open_old", spriteId, { status: "open", title: "Open old", createdAt: at("2026-09-12T09:00:00Z") });
		await job("j_draft", spriteId, { status: "draft", title: "A draft", createdAt: at("2026-10-12T09:00:00Z") });
		await job("j_closed", spriteId, { status: "closed", title: "Closed", createdAt: at("2026-09-02T09:00:00Z") });

		// Scored in October, uploaded across the last 10 days; two on the same day.
		await cv("j_open_now", spriteId, {
			id: "c_ada",
			name: "Ada Lovelace",
			status: "scored",
			score: 91,
			createdAt: at("2026-10-20T10:00:00Z"),
			scoredAt: at("2026-10-20T10:02:00Z"),
			decision: "shortlisted",
			// 6 hours after upload.
			decidedAt: at("2026-10-20T16:00:00Z"),
		});
		await cv("j_open_now", spriteId, {
			id: "c_bob",
			name: "Bob",
			status: "scored",
			score: 62,
			createdAt: at("2026-10-20T10:00:30Z"),
			scoredAt: at("2026-10-20T10:03:00Z"),
			decision: "rejected",
			decidedAt: at("2026-10-21T08:00:00Z"),
		});
		// Scored last month, shortlisted 40 days ago: counts for last month and the previous 30-day window.
		await cv("j_open_old", spriteId, {
			id: "c_old",
			name: "Old Timer",
			status: "scored",
			score: 80,
			createdAt: at("2026-09-10T08:00:00Z"),
			scoredAt: at("2026-09-10T08:05:00Z"),
			decision: "shortlisted",
			// 12 hours after upload.
			decidedAt: at("2026-09-10T20:00:00Z"),
		});
		// Failed, and still being read: received but not scored.
		await cv("j_open_now2", spriteId, { id: "c_fail", status: "failed", createdAt: at("2026-10-22T08:00:00Z"), updatedAt: at("2026-10-22T08:01:00Z") });
		await cv("j_open_now2", spriteId, { id: "c_queued", status: "queued", createdAt: at("2026-10-22T09:00:00Z") });
		// Older than 90 days: out of the funnel, and out of the chart, but scored all-time.
		await cv("j_closed", spriteId, {
			id: "c_ancient",
			name: "Ancient",
			status: "scored",
			score: 70,
			createdAt: at("2026-06-01T08:00:00Z"),
			scoredAt: at("2026-06-01T08:05:00Z"),
			decision: "shortlisted",
			decidedAt: at("2026-06-02T08:00:00Z"),
		});
		// Another company, which must never leak in.
		await job("j_acme", acmeId, { status: "open", title: "Acme role" });
		await cv("j_acme", acmeId, { id: "c_acme", name: "Spy", status: "scored", score: 100, scoredAt: ago(1), decision: "shortlisted", decidedAt: ago(1) });
		await db.insert(aiUsage).values([
			{ orgId: acmeId, operation: "cv_score", model: "m", ok: true, createdAt: ago(1) },
			{ orgId: spriteId, operation: "cv_score", model: "m", ok: true, createdAt: ago(2) },
			{ orgId: spriteId, operation: "cv_score", model: "m", ok: true, createdAt: ago(3) },
			{ orgId: spriteId, operation: "cv_score", model: "m", ok: false, createdAt: ago(3) },
			{ orgId: spriteId, operation: "cv_score", model: "m", ok: true, createdAt: ago(100) },
			{ orgId: spriteId, operation: "job_description_enhance", model: "m", ok: true, createdAt: at("2026-10-22T11:00:00Z") },
			{ orgId: spriteId, operation: "interview_questions", model: "m", ok: true, createdAt: ago(5) },
			{ orgId: spriteId, operation: "interview_questions", model: "m", ok: true, createdAt: ago(6) },
		]);
	});

	it("counts active roles and the change in open jobs created since last month", async () => {
		const { kpis } = await getOverview(db, spriteId, NOW);
		// Open now: three. Created in October: two. In September: one.
		expect(kpis.activeRoles).toEqual({ value: 3, change: 1 });
	});

	it("counts scored CVs all-time, this month and last month", async () => {
		const { kpis } = await getOverview(db, spriteId, NOW);
		expect(kpis.cvsScreened).toEqual({ value: 4, thisMonth: 2, lastMonth: 1 });
	});

	it("averages upload-to-shortlist hours over 30 days and the 30 before, shortlisted only", async () => {
		const { kpis } = await getOverview(db, spriteId, NOW);
		// Ada: 6 h, in the last 30 days. Old Timer: 12 h, decided 42 days ago. Bob was rejected, Ancient is too old.
		expect(kpis.avgTimeToShortlist).toEqual({ hours: 6, previousHours: 12 });
	});

	it("finds the top match with its candidate and job", async () => {
		const { kpis } = await getOverview(db, spriteId, NOW);
		expect(kpis.topMatch).toEqual({
			score: 91,
			candidateName: "Ada Lovelace",
			candidateId: "c_ada",
			jobId: "j_open_now",
			jobTitle: "Open now",
		});
	});

	it("zero-fills the last 10 UTC days and counts uploads per day", async () => {
		const { velocity } = await getOverview(db, spriteId, NOW);
		expect(velocity.days.map((d) => d.date)).toEqual([
			"2026-10-13",
			"2026-10-14",
			"2026-10-15",
			"2026-10-16",
			"2026-10-17",
			"2026-10-18",
			"2026-10-19",
			"2026-10-20",
			"2026-10-21",
			"2026-10-22",
		]);
		expect(velocity.days.find((d) => d.date === "2026-10-20")?.uploaded).toBe(2);
		expect(velocity.days.find((d) => d.date === "2026-10-22")?.uploaded).toBe(2);
		expect(velocity.days.reduce((sum, d) => sum + d.uploaded, 0)).toBe(4);
	});

	it("builds the 90-day funnel from recruiter decisions, not from rank", async () => {
		const { funnel, velocity } = await getOverview(db, spriteId, NOW);
		// Received since 24 Jul: all but the ancient one. Scored: Ada, Bob, Old Timer. Shortlisted: Ada, Old Timer.
		expect(funnel).toEqual({ received: 5, scored: 3, shortlisted: 2 });
		expect(velocity.totals).toEqual(funnel);
	});

	it("mixes AI output by operation, successful calls in the last 90 days only", async () => {
		const { aiMix } = await getOverview(db, spriteId, NOW);
		expect(aiMix).toEqual({ scoring: 2, descriptionRewrites: 1, interviewQuestions: 2 });
	});

	it("lists the latest 8 events, newest first, each linked to its job", async () => {
		const { activity } = await getOverview(db, spriteId, NOW);
		expect(activity).toHaveLength(8);
		expect(activity.map((e) => e.at)).toEqual(activity.map((e) => e.at).toSorted().toReversed());
		expect(activity[0]).toMatchObject({ type: "description_rewritten", jobId: null });
		const types = activity.map((e) => e.type);
		expect(types).toContain("cv_failed");
		expect(types).toContain("cvs_uploaded");
		const failed = activity.find((e) => e.type === "cv_failed");
		expect(failed).toMatchObject({ jobId: "j_open_now2", jobTitle: "Open too", candidateId: "c_fail" });
		const shortlisted = activity.find((e) => e.type === "shortlisted");
		expect(shortlisted).toMatchObject({ jobId: "j_open_now", candidateId: "c_ada", text: "Ada Lovelace was shortlisted for Open now" });
		expect(activity.find((e) => e.type === "rejected")?.text).toBe("Bob was rejected for Open now");
		expect(activity.map((e) => e.text).join("\n")).not.toContain("Spy");
	});

	it("groups CVs uploaded to one job in one minute into a single event", async () => {
		const batchId = (await createOrgForUser(db, "user_batch", "Batch Co")).org.id;
		await job("j_batch", batchId, { title: "Batch role", status: "open", createdAt: at("2026-10-01T09:00:00Z") });
		for (const second of [5, 20, 45]) {
			await cv("j_batch", batchId, { createdAt: at(`2026-10-21T10:00:${String(second).padStart(2, "0")}Z`) });
		}
		await cv("j_batch", batchId, { createdAt: at("2026-10-21T10:05:00Z") });

		const uploads = (await getOverview(db, batchId, NOW)).activity.filter((e) => e.type === "cvs_uploaded");
		expect(uploads.map((e) => e.text)).toEqual(["1 CV uploaded to Batch role", "3 CVs uploaded to Batch role"]);
	});

	it("never mixes in another company's numbers", async () => {
		const { kpis, funnel } = await getOverview(db, spriteId, NOW);
		expect(kpis.topMatch?.candidateName).not.toBe("Spy");
		expect(funnel.shortlisted).toBe(2);
		const acme = await getOverview(db, acmeId, NOW);
		expect(acme.kpis.activeRoles.value).toBe(1);
		expect(acme.aiMix.scoring).toBe(1);
	});
});

describe("GET /overview", () => {
	const get = (token: string | null) =>
		app.request("/overview", { headers: token ? { authorization: `Bearer t:${token}` } : {} }, env);

	it("needs a session and a company", async () => {
		expect((await get(null)).status).toBe(401);
		const noOrg = await get("user_new");
		expect(noOrg.status).toBe(403);
		expect(await noOrg.json()).toMatchObject({ error: { code: "no_org" } });
	});

	it("answers with the company's overview, uncached", async () => {
		const res = await get("user_empty");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toMatchObject({
			kpis: { topMatch: null },
			activity: [],
			aiMix: { scoring: 0 },
		});
	});
});
