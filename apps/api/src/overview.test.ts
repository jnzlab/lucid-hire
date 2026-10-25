import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs } from "./db/schema.ts";
import {
	getOverviewActivity,
	getOverviewAiMix,
	getOverviewAttention,
	getOverviewFunnel,
	getOverviewKpis,
	getOverviewVelocity,
} from "./overview.ts";
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
		expect(await getOverviewKpis(db, emptyId, NOW)).toEqual({
			activeRoles: { value: 0, change: 0 },
			cvsScreened: { value: 0, thisMonth: 0, lastMonth: 0 },
			awaitingDecision: { value: 0, scoredThisWeek: 0 },
			topMatch: null,
		});
		const funnel = await getOverviewFunnel(db, emptyId, NOW);
		expect(funnel).toEqual({ received: 0, scored: 0, shortlisted: 0 });
		const velocity = await getOverviewVelocity(db, emptyId, NOW);
		expect(velocity.totals).toEqual(funnel);
		expect(velocity.days).toHaveLength(10);
		expect(velocity.days[0]).toEqual({ date: "2026-10-13", uploaded: 0 });
		expect(velocity.days[9]).toEqual({ date: "2026-10-22", uploaded: 0 });
		expect(await getOverviewAiMix(db, emptyId, NOW)).toEqual({ scoring: 0, descriptionRewrites: 0, interviewQuestions: 0 });
		expect(await getOverviewActivity(db, emptyId)).toEqual([]);
	});
});

describe("CVs awaiting a decision", () => {
	let reviewId: string;
	beforeAll(async () => {
		reviewId = (await createOrgForUser(db, "user_review", "Review Co")).org.id;
		await job("j_review_open", reviewId, { status: "open", title: "Open role" });
		await job("j_review_closed", reviewId, { status: "closed", title: "Closed role" });
		await cv("j_review_open", reviewId, { status: "scored", score: 80, scoredAt: ago(2) });
		await cv("j_review_closed", reviewId, { status: "scored", score: 60, scoredAt: ago(10) });
		await cv("j_review_open", reviewId, { status: "scored", score: 90, scoredAt: ago(1), decision: "shortlisted", decidedAt: ago(1) });
		await cv("j_review_open", reviewId, { status: "scored", score: 40, scoredAt: ago(3), decision: "rejected", decidedAt: ago(3) });
		await cv("j_review_open", reviewId, { status: "queued" });
	});

	it("counts scored, undecided CVs on every job, and those scored in the last 7 days", async () => {
		const kpis = await getOverviewKpis(db, reviewId, NOW);
		// The two undecided scored CVs, one of them scored 2 days ago. Decided and unread CVs don't count.
		expect(kpis.awaitingDecision).toEqual({ value: 2, scoredThisWeek: 1 });
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
		const kpis = await getOverviewKpis(db, spriteId, NOW);
		// Open now: three. Created in October: two. In September: one.
		expect(kpis.activeRoles).toEqual({ value: 3, change: 1 });
	});

	it("counts scored CVs all-time, this month and last month", async () => {
		const kpis = await getOverviewKpis(db, spriteId, NOW);
		expect(kpis.cvsScreened).toEqual({ value: 4, thisMonth: 2, lastMonth: 1 });
	});

	it("has nothing awaiting a decision once every scored CV is decided", async () => {
		const kpis = await getOverviewKpis(db, spriteId, NOW);
		// Ada, Old Timer and Ancient are shortlisted and Bob is rejected; the failed and queued CVs aren't scored.
		expect(kpis.awaitingDecision).toEqual({ value: 0, scoredThisWeek: 0 });
	});

	it("finds the top match with its candidate and job", async () => {
		const kpis = await getOverviewKpis(db, spriteId, NOW);
		expect(kpis.topMatch).toEqual({
			score: 91,
			candidateName: "Ada Lovelace",
			candidateId: "c_ada",
			jobId: "j_open_now",
			jobTitle: "Open now",
		});
	});

	it("zero-fills the last 10 UTC days and counts uploads per day", async () => {
		const velocity = await getOverviewVelocity(db, spriteId, NOW);
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
		const funnel = await getOverviewFunnel(db, spriteId, NOW);
		const velocity = await getOverviewVelocity(db, spriteId, NOW);
		// Received since 24 Jul: all but the ancient one. Scored: Ada, Bob, Old Timer. Shortlisted: Ada, Old Timer.
		expect(funnel).toEqual({ received: 5, scored: 3, shortlisted: 2 });
		expect(velocity.totals).toEqual(funnel);
	});

	it("mixes AI output by operation, successful calls in the last 90 days only", async () => {
		const aiMix = await getOverviewAiMix(db, spriteId, NOW);
		expect(aiMix).toEqual({ scoring: 2, descriptionRewrites: 1, interviewQuestions: 2 });
	});

	it("lists the latest 8 events, newest first, each linked to its job", async () => {
		const activity = await getOverviewActivity(db, spriteId);
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

		const uploads = (await getOverviewActivity(db, batchId)).filter((e) => e.type === "cvs_uploaded");
		expect(uploads.map((e) => e.text)).toEqual(["1 CV uploaded to Batch role", "3 CVs uploaded to Batch role"]);
	});

	it("never mixes in another company's numbers", async () => {
		const kpis = await getOverviewKpis(db, spriteId, NOW);
		expect(kpis.topMatch?.candidateName).not.toBe("Spy");
		expect((await getOverviewFunnel(db, spriteId, NOW)).shortlisted).toBe(2);
		expect((await getOverviewKpis(db, acmeId, NOW)).activeRoles.value).toBe(1);
		expect((await getOverviewAiMix(db, acmeId, NOW)).scoring).toBe(1);
		const acmeActivity = await getOverviewActivity(db, acmeId);
		expect(acmeActivity.map((e) => e.text).join("\n")).not.toContain("Ada");
	});
});

describe("the work queue (attention)", () => {
	let queueId: string;

	beforeAll(async () => {
		queueId = (await createOrgForUser(db, "user_queue", "Queue Co")).org.id;
		await job("q_busy", queueId, { status: "open", title: "Busy", createdAt: at("2026-10-01T09:00:00Z") });
		await job("q_reading", queueId, { status: "open", title: "Reading only", createdAt: at("2026-10-02T09:00:00Z") });
		await job("q_quiet", queueId, { status: "open", title: "Quiet", createdAt: at("2026-10-03T09:00:00Z") });
		await job("q_empty", queueId, { status: "open", title: "Empty", slug: "empty-abc12345", createdAt: at("2026-10-04T09:00:00Z") });
		await job("q_closed", queueId, { status: "closed", title: "Closed", createdAt: at("2026-09-01T09:00:00Z") });
		await job("q_draft1", queueId, { status: "draft", title: "Draft one", updatedAt: at("2026-10-10T09:00:00Z") });
		await job("q_draft2", queueId, { status: "draft", title: "Draft two", updatedAt: at("2026-10-12T09:00:00Z") });

		const scoredCv = (jobId: string, id: string, name: string, score: number, scoredAt: string, fields: Partial<typeof candidates.$inferInsert> = {}) =>
			cv(jobId, queueId, { id, name, headline: `${name}'s headline`, status: "scored", score, scoredAt: at(scoredAt), ...fields });
		// Busy: four to review (Kim and Lee tie on 75; Kim was scored first), one shortlisted, one being read, one failed.
		await scoredCv("q_busy", "q_joy", "Joy", 88, "2026-10-20T09:00:00Z");
		await scoredCv("q_busy", "q_kim", "Kim", 75, "2026-10-19T10:00:00Z");
		await scoredCv("q_busy", "q_lee", "Lee", 75, "2026-10-19T11:00:00Z");
		await scoredCv("q_busy", "q_max", "Max", 60, "2026-10-08T09:00:00Z");
		await scoredCv("q_busy", "q_ned", "Ned", 90, "2026-10-20T08:00:00Z", { decision: "shortlisted", decidedAt: at("2026-10-20T10:00:00Z") });
		await cv("q_busy", queueId, { status: "queued" });
		await cv("q_busy", queueId, { status: "failed" });
		await cv("q_reading", queueId, { status: "scoring" });
		await scoredCv("q_quiet", "q_old", "Old", 50, "2026-10-01T09:00:00Z", { decision: "shortlisted" });
		// A closed job still has CVs to review and two that failed.
		await scoredCv("q_closed", "q_top", "Top", 95, "2026-10-21T09:00:00Z");
		await cv("q_closed", queueId, { status: "failed" });
		await cv("q_closed", queueId, { status: "failed", decision: "rejected" });
		// Another company's CV waiting for review must never show up here.
		await cv("j_acme", acmeId, { id: "q_spy", name: "Spy", status: "scored", score: 99, scoredAt: ago(1) });
	});

	it("totals the company's CVs to review, being read and failed, with its open jobs", async () => {
		const { totals } = await getOverviewAttention(db, queueId, NOW);
		expect(totals).toEqual({ toReview: 5, reading: 2, failed: 3, openJobs: 4, jobsToReview: 2 });
	});

	it("lists open jobs waiting for a decision, most to review first, with their best three to review", async () => {
		const { waiting } = await getOverviewAttention(db, queueId, NOW);
		expect(waiting).toEqual([
			{
				jobId: "q_busy",
				jobTitle: "Busy",
				toReview: 4,
				shortlisted: 1,
				reading: 1,
				top: [
					{ candidateId: "q_joy", name: "Joy", fileName: expect.any(String), headline: "Joy's headline", score: 88 },
					{ candidateId: "q_kim", name: "Kim", fileName: expect.any(String), headline: "Kim's headline", score: 75 },
					{ candidateId: "q_lee", name: "Lee", fileName: expect.any(String), headline: "Lee's headline", score: 75 },
				],
			},
			{ jobId: "q_reading", jobTitle: "Reading only", toReview: 0, shortlisted: 0, reading: 1, top: [] },
		]);
	});

	it("lists failed CVs by job, open jobs without CVs and the latest drafts", async () => {
		const attention = await getOverviewAttention(db, queueId, NOW);
		expect(attention.failed).toEqual([
			{ jobId: "q_closed", jobTitle: "Closed", count: 2 },
			{ jobId: "q_busy", jobTitle: "Busy", count: 1 },
		]);
		expect(attention.emptyOpenJobs).toEqual([{ jobId: "q_empty", jobTitle: "Empty", slug: "empty-abc12345" }]);
		expect(attention.drafts).toEqual([
			{ jobId: "q_draft2", jobTitle: "Draft two", updatedAt: "2026-10-12T09:00:00.000Z" },
			{ jobId: "q_draft1", jobTitle: "Draft one", updatedAt: "2026-10-10T09:00:00.000Z" },
		]);
	});

	it("picks the five best CVs scored in the last 7 days, whatever their job or decision", async () => {
		const { bestNew } = await getOverviewAttention(db, queueId, NOW);
		expect(bestNew.map((c) => [c.candidateId, c.score])).toEqual([
			["q_top", 95],
			["q_ned", 90],
			["q_joy", 88],
			["q_lee", 75],
			["q_kim", 75],
		]);
		expect(bestNew[0]).toEqual({
			candidateId: "q_top",
			jobId: "q_closed",
			jobTitle: "Closed",
			name: "Top",
			fileName: expect.any(String),
			headline: "Top's headline",
			score: 95,
			decision: "undecided",
			scoredAt: "2026-10-21T09:00:00.000Z",
		});
		expect(bestNew[1].decision).toBe("shortlisted");
	});

	it("caps the waiting jobs at 6 and each job's list at 3", async () => {
		const manyId = (await createOrgForUser(db, "user_many", "Many Co")).org.id;
		for (let i = 1; i <= 8; i++) {
			await job(`m_${i}`, manyId, { status: "open", title: `Role ${i}`, createdAt: at(`2026-10-0${i}T09:00:00Z`) });
			for (let k = 0; k < i; k++) await cv(`m_${i}`, manyId, { status: "scored", score: 50 + k, scoredAt: ago(1) });
		}
		const { waiting, totals } = await getOverviewAttention(db, manyId, NOW);
		expect(waiting.map((w) => [w.jobTitle, w.toReview, w.top.length])).toEqual([
			["Role 8", 8, 3],
			["Role 7", 7, 3],
			["Role 6", 6, 3],
			["Role 5", 5, 3],
			["Role 4", 4, 3],
			["Role 3", 3, 3],
		]);
		expect(waiting[0].top.map((c) => c.score)).toEqual([57, 56, 55]);
		expect(totals).toMatchObject({ toReview: 36, jobsToReview: 8, openJobs: 8 });
	});

	it("never mixes in another company's CVs", async () => {
		const attention = await getOverviewAttention(db, queueId, NOW);
		expect(JSON.stringify(attention)).not.toContain("Spy");
		const acme = await getOverviewAttention(db, acmeId, NOW);
		expect(acme.totals.toReview).toBe(1);
		expect(acme.waiting[0].top[0]).toMatchObject({ candidateId: "q_spy" });
	});
});

describe("the overview endpoints", () => {
	const paths = ["kpis", "velocity", "funnel", "ai-mix", "activity", "attention"];
	const get = (path: string, token: string | null) =>
		app.request(`/overview/${path}`, { headers: token ? { authorization: `Bearer t:${token}` } : {} }, env);

	it("need a session and a company", async () => {
		for (const path of paths) {
			expect((await get(path, null)).status).toBe(401);
			const noOrg = await get(path, "user_new");
			expect(noOrg.status).toBe(403);
			expect(await noOrg.json()).toMatchObject({ error: { code: "no_org" } });
		}
	});

	it("answer with one card's numbers each, uncached", async () => {
		const expected: Record<string, unknown> = {
			kpis: { topMatch: null, activeRoles: { value: 0 } },
			velocity: { totals: { received: 0 } },
			funnel: { received: 0, scored: 0, shortlisted: 0 },
			"ai-mix": { scoring: 0 },
			activity: { events: [] },
			attention: {
				totals: { toReview: 0, reading: 0, failed: 0, openJobs: 0, jobsToReview: 0 },
				waiting: [],
				failed: [],
				emptyOpenJobs: [],
				drafts: [],
				bestNew: [],
			},
		};
		for (const path of paths) {
			const res = await get(path, "user_empty");
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(await res.json()).toMatchObject(expected[path] as object);
		}
	});

	it("no longer serve the combined overview", async () => {
		expect((await get("", "user_empty")).status).toBe(404);
	});
});
