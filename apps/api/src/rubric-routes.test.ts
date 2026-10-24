import type { EvidenceMap, RubricItem } from "@lucid-hire/scoring";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { candidates, jobs, members, usageCounters } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";
import { hourPeriod, readUnits } from "./usage.ts";

type Instance = { id: string; params: { candidateId: string; mode: string } };

let env: Env;
let db: Db;
let dispose: () => Promise<void>;
let orgId: string;
let acmeOrgId: string;
let allowAi: boolean;
let drafts: { id: string; params: unknown }[];
let failDraft: boolean;
let batches: Instance[][];
// CVs whose check run the fake Workflows refuses to start.
let refuse: Set<string>;

// Tokens are "t:<userId>" in these tests.
const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};

const app = createApp({ verifySession: verify });

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		DB: testD1.d1,
		AI_RATE_LIMIT: { limit: async () => ({ success: allowAi }) },
		DRAFT_RUBRIC: {
			create: async (options: { id: string; params: unknown }) => {
				if (failDraft) throw new Error("Workflows is down");
				drafts.push(options);
				return { id: options.id };
			},
		},
		// Records each batch of check runs, and reports the refused ones as Workflows does: per instance.
		SCORE_CV: {
			createBatch: async ({ instances }: { instances: Instance[] }) => {
				batches.push(instances);
				const errors = instances.flatMap((instance, index) =>
					refuse.has(instance.params.candidateId) ? [{ index, id: instance.id, code: "internal", message: "Workflows is down" }] : [],
				);
				return { created: instances.filter((instance) => !refuse.has(instance.params.candidateId)), errors };
			},
		},
	} as unknown as Env;
	db = getDb(testD1.d1);

	// Sprite Labs: an admin and a member. Acme: a second company whose jobs Sprite Labs must never reach.
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
	await db.insert(members).values({ orgId, userId: "user_member", role: "member" });
	acmeOrgId = (await createOrgForUser(db, "user_acme", "Acme")).org.id;
});

afterAll(() => dispose());

beforeEach(async () => {
	await db.delete(usageCounters);
	allowAi = true;
	drafts = [];
	failDraft = false;
	batches = [];
	refuse = new Set();
});

// Runs a request with a fake execution context and waits for its waitUntil work.
async function call(user: string | null, method: string, path: string, body?: unknown) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const headers: Record<string, string> = user ? { authorization: `Bearer t:${user}` } : {};
	if (body !== undefined) headers["content-type"] = "application/json";
	const res = await app.request(
		path,
		{ method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
		env,
		ctx as unknown as ExecutionContext,
	);
	await Promise.all(pending);
	return res;
}

const item = (id: string, label: string, weight: RubricItem["weight"] = "must", extra: Partial<RubricItem> = {}): RubricItem => ({
	id,
	label,
	detail: `Needs ${label}`,
	weight,
	...extra,
});

// Swift and SwiftUI must, Figma nice. Combine was removed.
const RUBRIC: RubricItem[] = [
	item("r1", "Swift"),
	item("r2", "SwiftUI"),
	item("r3", "Figma", "nice"),
	item("r4", "Combine", "must", { removed: true }),
];

async function seedJob(values: Partial<typeof jobs.$inferInsert> = {}, owner = orgId) {
	const id = crypto.randomUUID();
	await db.insert(jobs).values({
		id,
		orgId: owner,
		title: "iOS Engineer",
		description: "Swift, SwiftUI. Figma is a plus.",
		status: "open",
		createdBy: "user_admin",
		rubric: RUBRIC,
		rubricStatus: "ready",
		rubricVersion: 1,
		updatedAt: new Date(Date.now() - 3_600_000),
		...values,
	});
	return id;
}

async function seedCandidate(jobId: string, values: Partial<typeof candidates.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	await db.insert(candidates).values({
		id,
		orgId,
		jobId,
		fileKey: `${orgId}/${jobId}/${id}.pdf`,
		fileName: "cv.pdf",
		fileSize: 100,
		createdBy: "user_admin",
		...values,
	});
	return id;
}

const jobRow = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const candidateRow = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];
const aiUnits = () => readUnits(db, orgId, "ai_hour", hourPeriod(Date.now()));

const clear = (quote: string) => ({ level: "clear" as const, quote });
const none = { level: "none" as const, quote: "" };

// Clear on Swift and Figma, nothing for SwiftUI: 4 of 7, 57.
const EVIDENCE: EvidenceMap = { r1: clear("Six years of Swift"), r2: none, r3: clear("Figma daily") };

describe("access", () => {
	it("needs a session and a company, and lets any member change the list", async () => {
		const jobId = await seedJob();
		const change = { changes: [{ id: "r3", weight: "must" }] };
		expect((await call(null, "PATCH", `/jobs/${jobId}/rubric`, change)).status).toBe(401);
		expect((await call("user_new", "PATCH", `/jobs/${jobId}/rubric`, change)).status).toBe(403);
		expect((await call("user_member", "PATCH", `/jobs/${jobId}/rubric`, change)).status).toBe(200);
	});

	it("404s for another company's job and a missing one, on every route", async () => {
		const acmeJob = await seedJob({}, acmeOrgId);
		for (const jobId of [acmeJob, "missing"]) {
			const routes: [string, string, unknown?][] = [
				["PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r1", weight: "nice" }] }],
				["POST", `/jobs/${jobId}/rubric/requirements`, { label: "Go", detail: "Go", weight: "nice" }],
				["POST", `/jobs/${jobId}/rubric/check`],
				["POST", `/jobs/${jobId}/rubric/draft`],
			];
			for (const [method, path, body] of routes) {
				const res = await call("user_admin", method, path, body);
				expect(res.status).toBe(404);
				expect(await res.json()).toEqual({ error: { code: "job_not_found", message: "That job doesn't exist or isn't yours" } });
			}
		}
		expect((await jobRow(acmeJob)).rubric).toEqual(RUBRIC);
		expect(drafts).toEqual([]);
		expect(await aiUnits()).toBe(0);
	});
});

describe("PATCH /jobs/:jobId/rubric", () => {
	it("changes weights and labels, removes requirements and re-scores every scored CV at once", async () => {
		const jobId = await seedJob();
		const ada = await seedCandidate(jobId, { status: "scored", score: 57, evidence: EVIDENCE });
		const bob = await seedCandidate(jobId, { status: "scored", score: 0, evidence: { r1: none, r2: clear("SwiftUI"), r3: none } });
		const legacy = await seedCandidate(jobId, { status: "scored", score: 81, evidence: null });
		const reading = await seedCandidate(jobId, { status: "scoring" });

		const res = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, {
			changes: [
				{ id: "r2", removed: true },
				{ id: "r3", weight: "must", label: "  Figma   files " },
			],
		});
		expect(res.status).toBe(200);
		const { job } = (await res.json()) as { job: { rubric: RubricItem[]; rubricStatus: string; updatedAt: string } };
		expect(job.rubricStatus).toBe("ready");
		expect(job.rubric).toEqual([
			RUBRIC[0],
			{ ...RUBRIC[1], removed: true },
			{ ...RUBRIC[2], weight: "must", label: "Figma files" },
			RUBRIC[3],
		]);
		// The change counts as an edit to the job.
		expect(Date.now() - Date.parse(job.updatedAt)).toBeLessThan(60_000);
		expect((await jobRow(jobId)).rubricVersion).toBe(2);

		// Ada is clear on both requirements left, Bob on neither. Nothing else is touched.
		expect((await candidateRow(ada)).score).toBe(100);
		expect((await candidateRow(bob)).score).toBe(0);
		expect((await candidateRow(legacy)).score).toBe(81);
		expect(await candidateRow(reading)).toMatchObject({ status: "scoring", score: null });
	});

	it("turns a requirement Off so it stops counting, and gives a null score when nothing counts", async () => {
		const jobId = await seedJob({ rubric: [item("r1", "Swift"), item("r2", "Figma", "nice")] });
		const id = await seedCandidate(jobId, { status: "scored", score: 25, evidence: { r1: none, r2: clear("Figma") } });

		await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r1", weight: "off" }] });
		expect((await candidateRow(id)).score).toBe(100);
		await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r2", weight: "off" }] });
		expect((await candidateRow(id)).score).toBeNull();
	});

	it("refuses an id that isn't on the job, removed ones included, and changes nothing (400 unknown_requirement)", async () => {
		const jobId = await seedJob();
		for (const id of ["r9", "r4"]) {
			const res = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, {
				changes: [
					{ id: "r1", weight: "nice" },
					{ id, weight: "nice" },
				],
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: { code: "unknown_requirement", message: "That requirement isn't on this job." },
			});
		}
		expect(await jobRow(jobId)).toMatchObject({ rubric: RUBRIC, rubricVersion: 1 });
	});

	it("keeps at least one requirement (400 rubric_empty)", async () => {
		const jobId = await seedJob();
		const res = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, {
			changes: [
				{ id: "r1", removed: true },
				{ id: "r2", removed: true },
				{ id: "r3", removed: true },
			],
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: "rubric_empty", message: "Keep at least one requirement on the job." } });
		expect((await jobRow(jobId)).rubric).toEqual(RUBRIC);
	});

	it("waits for the list to be drafted (409 rubric_not_ready)", async () => {
		for (const rubricStatus of ["none", "drafting", "failed"] as const) {
			const jobId = await seedJob({ rubric: rubricStatus === "none" ? null : RUBRIC, rubricStatus });
			const res = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r1", weight: "nice" }] });
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: "rubric_not_ready", message: "The requirements aren't ready yet. Try again once they're drafted." },
			});
		}
	});

	it("checks the body field by field (400 invalid_input)", async () => {
		const jobId = await seedJob();
		const bad = [
			{},
			{ changes: [] },
			{ changes: Array.from({ length: 16 }, (_, i) => ({ id: `r${i + 1}`, weight: "nice" })) },
			{ changes: [{ id: "r1" }] },
			{ changes: [{ id: "r1", label: "   " }] },
			{ changes: [{ id: "r1", label: "x".repeat(41) }] },
			{ changes: [{ id: "r1", weight: "maybe" }] },
			{ changes: [{ id: "r1", removed: false }] },
			{ changes: [{ id: "r1", weight: "nice" }, { id: "r1", label: "Swift" }] },
		];
		for (const body of bad) {
			const res = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
		expect((await jobRow(jobId)).rubricVersion).toBe(1);

		// Forty characters is fine.
		const ok = await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r1", label: "y".repeat(40) }] });
		expect(ok.status).toBe(200);
	});
});

describe("POST /jobs/:jobId/rubric/requirements", () => {
	it("adds a requirement with a new id, not yet checked on any CV, and re-scores", async () => {
		const jobId = await seedJob();
		const ada = await seedCandidate(jobId, { status: "scored", score: 57, evidence: EVIDENCE });

		const res = await call("user_member", "POST", `/jobs/${jobId}/rubric/requirements`, {
			label: "  Core   Data ",
			detail: "  Has shipped Core Data models ",
			weight: "must",
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { job: { rubric: RubricItem[] }; item: RubricItem };
		// r4 was removed, so the new one is r5: an id is never reused.
		const added = { id: "r5", label: "Core Data", detail: "Has shipped Core Data models", weight: "must" };
		expect(body.item).toEqual(added);
		expect(body.job.rubric).toEqual([...RUBRIC, added]);
		// Not checked counts as not met: 4 of 10.
		expect((await candidateRow(ada)).score).toBe(40);

		// The list now offers Ada for "Check all".
		const { candidates: list } = (await (await call("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: { checks: { id: string; level: string | null }[] }[];
		};
		expect(list[0].checks.at(-1)).toEqual({ id: "r5", label: "Core Data", weight: "must", level: null });
	});

	it(`stops at 15 requirements on the job (409 rubric_full)`, async () => {
		const full = Array.from({ length: 15 }, (_, i) => item(`r${i + 1}`, `Skill ${i + 1}`));
		const jobId = await seedJob({ rubric: [...full, item("r16", "Gone", "nice", { removed: true })] });
		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/requirements`, { label: "One more", detail: "x", weight: "nice" });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: { code: "rubric_full", message: "This job already has 15 requirements. Remove one first." },
		});

		// Removing one makes room.
		await call("user_admin", "PATCH", `/jobs/${jobId}/rubric`, { changes: [{ id: "r2", removed: true }] });
		const added = await call("user_admin", "POST", `/jobs/${jobId}/rubric/requirements`, { label: "One more", detail: "x", weight: "nice" });
		expect(added.status).toBe(201);
		expect(((await added.json()) as { item: RubricItem }).item.id).toBe("r17");
	});

	it("waits for the list to be drafted (409 rubric_not_ready)", async () => {
		const jobId = await seedJob({ rubric: null, rubricStatus: "drafting" });
		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/requirements`, { label: "Go", detail: "Go", weight: "nice" });
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "rubric_not_ready" } });
	});

	it("checks the label, the detail and the weight (400 invalid_input)", async () => {
		const jobId = await seedJob();
		const bad = [
			{ detail: "Go", weight: "nice" },
			{ label: " ", detail: "Go", weight: "nice" },
			{ label: "x".repeat(41), detail: "Go", weight: "nice" },
			{ label: "Go", detail: "  ", weight: "nice" },
			{ label: "Go", detail: "x".repeat(301), weight: "nice" },
			{ label: "Go", detail: "Go", weight: "maybe" },
		];
		for (const body of bad) {
			const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/requirements`, body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
		expect((await jobRow(jobId)).rubric).toEqual(RUBRIC);
	});
});

describe("POST /jobs/:jobId/rubric/check", () => {
	it("starts one check run for each scored CV missing evidence for a requirement on the job", async () => {
		const jobId = await seedJob();
		const stale = new Date(Date.now() - 21 * 60_000);
		const missingOne = await seedCandidate(jobId, { status: "scored", score: 80, evidence: { r1: EVIDENCE.r1, r3: EVIDENCE.r3 } });
		const missingAll = await seedCandidate(jobId, { status: "scored", score: 0, evidence: {} });
		const quietRun = await seedCandidate(jobId, { status: "scored", evidence: { r1: none }, checkState: "checking", checkIds: ["r2"], updatedAt: stale });
		// None of these: complete (a removed requirement doesn't count), being checked, scored before
		// requirements, failed, or still being read.
		await seedCandidate(jobId, { status: "scored", evidence: EVIDENCE });
		await seedCandidate(jobId, { status: "scored", evidence: { r1: none }, checkState: "checking", checkIds: ["r2"] });
		await seedCandidate(jobId, { status: "scored", score: 70, evidence: null });
		await seedCandidate(jobId, { status: "failed", evidence: {} });
		await seedCandidate(jobId, { status: "scoring" });
		// Another job's CV is never touched.
		const otherJob = await seedJob();
		const elsewhere = await seedCandidate(otherJob, { status: "scored", evidence: {} });

		const res = await call("user_member", "POST", `/jobs/${jobId}/rubric/check`);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ started: 3 });

		expect(batches).toHaveLength(1);
		const started = batches[0];
		expect(started.map((instance) => instance.params.candidateId).sort()).toEqual([missingOne, missingAll, quietRun].sort());
		for (const instance of started) {
			expect(instance.params.mode).toBe("check");
			expect(instance.id).toMatch(new RegExp(`^${instance.params.candidateId}-check-\\d+$`));
		}
		expect(await candidateRow(missingOne)).toMatchObject({ status: "scored", score: 80, checkState: "queued", checkIds: ["r2"] });
		expect((await candidateRow(missingAll)).checkIds).toEqual(["r1", "r2", "r3"]);
		expect(await candidateRow(quietRun)).toMatchObject({ checkState: "queued", checkIds: ["r2", "r3"] });
		expect((await candidateRow(elsewhere)).checkState).toBeNull();
		expect(await aiUnits()).toBe(1);

		// The list shows them as being checked, still scored and ranked.
		const { candidates: list } = (await (await call("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: { id: string; status: string; checking: boolean }[];
		};
		expect(list.find((c) => c.id === missingOne)).toMatchObject({ status: "scored", checking: true });

		// A second click finds nothing left to start and gives the AI request back.
		const again = await call("user_member", "POST", `/jobs/${jobId}/rubric/check`);
		expect(await again.json()).toEqual({ started: 0 });
		expect(batches).toHaveLength(1);
		expect(await aiUnits()).toBe(1);
	});

	it("starts runs 100 to a call", async () => {
		const jobId = await seedJob();
		const values = Array.from({ length: 101 }, () => ({
			id: crypto.randomUUID(),
			orgId,
			jobId,
			fileKey: "k",
			fileName: "cv.pdf",
			fileSize: 1,
			createdBy: "user_admin",
			status: "scored" as const,
			evidence: {},
		}));
		for (let at = 0; at < values.length; at += 8) await db.insert(candidates).values(values.slice(at, at + 8));

		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/check`);
		expect(await res.json()).toEqual({ started: 101 });
		expect(batches.map((batch) => batch.length)).toEqual([100, 1]);
	});

	it("drops the runs Workflows wouldn't start, so they can be started again", async () => {
		const jobId = await seedJob();
		const ok = await seedCandidate(jobId, { status: "scored", evidence: {} });
		const refused = await seedCandidate(jobId, { status: "scored", evidence: {} });
		refuse.add(refused);

		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/check`);
		expect(await res.json()).toEqual({ started: 1 });
		expect((await candidateRow(ok)).checkState).toBe("queued");
		expect(await candidateRow(refused)).toMatchObject({ checkState: null, checkIds: null, status: "scored" });
	});

	it("waits for the list to be drafted, and spends nothing (409 rubric_not_ready)", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting" });
		await seedCandidate(jobId, { status: "scored", evidence: {} });
		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/check`);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "rubric_not_ready" } });
		expect(batches).toEqual([]);
		expect(await aiUnits()).toBe(0);
	});

	it("stops at the company's AI limits, like rewriting a description (429)", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId, { status: "scored", evidence: {} });

		allowAi = false;
		const burst = await call("user_admin", "POST", `/jobs/${jobId}/rubric/check`);
		expect(burst.status).toBe(429);
		expect(await burst.json()).toEqual({
			error: { code: "rate_limited", message: "That's 10 AI requests this minute. Try again in a minute." },
		});

		allowAi = true;
		await db.insert(usageCounters).values({ orgId, metric: "ai_hour", period: hourPeriod(Date.now()), count: 30 });
		const hourly = await call("user_admin", "POST", `/jobs/${jobId}/rubric/check`);
		expect(hourly.status).toBe(429);
		expect(hourly.headers.get("retry-after")).not.toBeNull();
		expect(await hourly.json()).toMatchObject({ error: { code: "plan_limit" } });

		expect(batches).toEqual([]);
		expect((await candidateRow(id)).checkState).toBeNull();
	});
});

describe("POST /jobs/:jobId/rubric/draft", () => {
	it("drafts the list again from the job, keeping the current one until the draft lands", async () => {
		const jobId = await seedJob();
		const res = await call("user_member", "POST", `/jobs/${jobId}/rubric/draft`);
		expect(res.status).toBe(202);
		const { job } = (await res.json()) as { job: { rubric: RubricItem[]; rubricStatus: string } };
		expect(job).toMatchObject({ rubric: RUBRIC, rubricStatus: "drafting" });
		expect(drafts).toEqual([{ id: `rubric-${jobId}-v2`, params: { jobId, version: 2, userId: "user_member" } }]);
		expect(await jobRow(jobId)).toMatchObject({ rubricStatus: "drafting", rubricVersion: 2 });
		expect(await aiUnits()).toBe(1);

		// While it drafts, the list can't be drafted again or edited.
		const again = await call("user_member", "POST", `/jobs/${jobId}/rubric/draft`);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({ error: { code: "rubric_drafting", message: "The requirements are already being drafted." } });
		expect(drafts).toHaveLength(1);
		expect(await aiUnits()).toBe(1);
	});

	it("drafts a job that has no list yet, or whose last draft failed", async () => {
		for (const rubricStatus of ["none", "failed"] as const) {
			drafts = [];
			const jobId = await seedJob({ rubric: null, rubricStatus });
			const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/draft`);
			expect(res.status).toBe(202);
			expect(drafts).toEqual([{ id: `rubric-${jobId}-v2`, params: { jobId, version: 2, userId: "user_admin" } }]);
		}
	});

	it("answers with the draft failed when the Workflow won't start, so it can be tried again", async () => {
		const jobId = await seedJob();
		failDraft = true;
		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/draft`);
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({ job: { rubric: RUBRIC, rubricStatus: "failed" } });
		expect((await jobRow(jobId)).rubricStatus).toBe("failed");

		failDraft = false;
		expect((await call("user_admin", "POST", `/jobs/${jobId}/rubric/draft`)).status).toBe(202);
		expect(drafts).toEqual([{ id: `rubric-${jobId}-v3`, params: { jobId, version: 3, userId: "user_admin" } }]);
	});

	it("stops at the company's AI limit without starting anything (429)", async () => {
		const jobId = await seedJob();
		allowAi = false;
		const res = await call("user_admin", "POST", `/jobs/${jobId}/rubric/draft`);
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: { code: "rate_limited" } });
		expect(drafts).toEqual([]);
		expect(await jobRow(jobId)).toMatchObject({ rubricStatus: "ready", rubricVersion: 1 });
	});
});
