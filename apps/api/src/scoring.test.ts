import type { EvidenceMap, RubricItem } from "@lucid-hire/scoring";
import { AISDKError, APICallError, RetryError } from "ai";
import { desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CvScore, type CvScoreInput, type CvScorer, isUnreadableFileError } from "./cv-scorer.ts";
import { GEMINI_TEXT_MODEL } from "./ai.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs, organizations, usageCounters } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import {
	type DraftLauncher,
	PermanentScoringError,
	RUBRIC_FAILED_MESSAGE,
	RUBRIC_MAX_POLLS,
	RubricUnavailableError,
	SCORING_FAILED_MESSAGE,
	UNREADABLE_MESSAGE,
	failureMessage,
	markFailed,
	QUEUE_FULL_MESSAGE,
	QueueTimeoutError,
	WAITER_LIVE_MS,
	endCheck,
	enterQueue,
	prepareRubric,
	readRubric,
	runScoreCv,
	takeSlot,
	saveScore,
	scoreCandidate,
} from "./scoring.ts";
import type { DraftRubricParams } from "./rubric.ts";
import { createTestD1 } from "./test/d1.ts";
import { fakeStep, nonRetryable } from "./test/steps.ts";
import { RENEWAL_GRACE_MS } from "./plan-state.ts";

let db: Db;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let orgId: string;
let jobId: string;
let scorerCalls: CvScoreInput[];
let scorerError: unknown;

const PDF = new TextEncoder().encode("%PDF-1.4 a small CV");

// The job's requirements. Combine was removed, so it is neither read nor scored.
const RUBRIC: RubricItem[] = [
	{ id: "r1", label: "Swift", detail: "5+ years of Swift", weight: "must" },
	{ id: "r2", label: "SwiftUI", detail: "SwiftUI", weight: "must" },
	{ id: "r3", label: "Figma", detail: "Figma is a plus", weight: "nice" },
	{ id: "r4", label: "Kotlin", detail: "Kotlin", weight: "nice" },
	{ id: "r5", label: "Combine", detail: "Combine", weight: "must", removed: true },
];
const VISIBLE = RUBRIC.filter((item) => !item.removed).map(({ id, label, detail }) => ({ id, label, detail }));

const evidence: EvidenceMap = {
	r1: { level: "clear", quote: "Six years of Swift" },
	r2: { level: "partial", quote: "Prototyped a screen in SwiftUI" },
	r3: { level: "partial", quote: "Worked next to designers" },
	r4: { level: "none", quote: "" },
};

const score: CvScore = {
	name: "Ada Lovelace",
	headline: "Senior iOS Engineer · London",
	summary: "Ada has six years of Swift and some SwiftUI. She has no Kotlin experience.",
	evidence,
	profile: {
		email: "ada@example.com",
		location: "London, UK",
		links: [{ label: "GitHub", url: "https://github.com/ada" }],
		skills: ["Swift", "SwiftUI"],
		experience: [{ title: "Senior iOS Engineer", company: "Analytical Engines" }],
		education: [],
		certifications: [],
	},
};

// Answers with `score`, or with clear evidence for exactly the requirements a run asks about.
let scorerAnswer: "fixed" | "asked";
const scorer: CvScorer = async (input) => {
	scorerCalls.push(input);
	if (scorerError) throw scorerError;
	if (scorerAnswer === "fixed") return { value: score, inputTokens: 1200, outputTokens: 340 };
	const ids = input.onlyIds ?? input.rubric.map(({ id }) => id);
	const asked = Object.fromEntries(ids.map((id) => [id, { level: "clear" as const, quote: `Shows ${id}` }]));
	return { value: { ...score, evidence: asked }, inputTokens: 100, outputTokens: 20 };
};

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	bucket = testD1.cvs;
	db = getDb(testD1.d1);
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
	jobId = crypto.randomUUID();
	await db.insert(jobs).values({
		id: jobId,
		orgId,
		createdBy: "user_admin",
		title: "Senior iOS Engineer",
		description: "Swift 5+ years, SwiftUI. Figma is a plus.",
		status: "open",
		rubric: RUBRIC,
		rubricStatus: "ready",
	});
});

afterAll(() => dispose());

beforeEach(async () => {
	// Every test starts with a fresh monthly job allowance, and the job with its requirements as above.
	await db.delete(usageCounters);
	await db.update(jobs).set({ rubric: RUBRIC, rubricStatus: "ready" }).where(eq(jobs.id, jobId));
	scorerCalls = [];
	scorerError = undefined;
	scorerAnswer = "fixed";
});

// A queued candidate, with its PDF in R2 unless `withFile` is false.
async function seedCandidate({
	withFile = true,
	name,
	...values
}: { withFile?: boolean; name?: string } & Partial<typeof candidates.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	const fileKey = `${orgId}/${jobId}/${id}.pdf`;
	await db.insert(candidates).values({
		id,
		orgId,
		jobId,
		fileKey,
		fileName: "ada.pdf",
		fileSize: PDF.byteLength,
		createdBy: "user_admin",
		name,
		...values,
	});
	if (withFile) await bucket.put(fileKey, PDF);
	return id;
}

const rowOf = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];

// ai_usage rows are shared by every test here, so each test looks only at the rows written after it began.
const usageMark = async () => (await db.select().from(aiUsage).orderBy(desc(aiUsage.id)).limit(1))[0]?.id ?? 0;
const usageSince = (mark: number) => db.select().from(aiUsage).where(gt(aiUsage.id, mark));

const apiError = (statusCode: number, message = `Gemini answered ${statusCode}`, responseBody?: string) =>
	new APICallError({ message, url: "https://gemini.test", requestBodyValues: {}, statusCode, responseBody });

// The shape of Gemini's error body.
const geminiBody = (message: string) => JSON.stringify({ error: { code: 400, message, status: "INVALID_ARGUMENT" } });

describe("isUnreadableFileError", () => {
	it("flags a 400 that blames the document, in the message or the response body", () => {
		expect(isUnreadableFileError(apiError(400, "The document has no pages."))).toBe(true);
		for (const detail of ["Unsupported MIME type: text/plain", "Unable to process input document"]) {
			expect(isUnreadableFileError(apiError(400, "Bad Request", geminiBody(detail)))).toBe(true);
		}
	});

	it("flags a PDF the Files API couldn't process", () => {
		const processingFailed = new AISDKError({ name: "GOOGLE_FILES_UPLOAD_FAILED", message: "File processing failed" });
		expect(isUnreadableFileError(processingFailed)).toBe(true);
	});

	it("looks inside a RetryError at the last error", () => {
		const retried = (last: unknown) =>
			new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [apiError(503), last] });
		expect(isUnreadableFileError(retried(apiError(400, "The document has no pages.")))).toBe(true);
		expect(isUnreadableFileError(retried(apiError(503)))).toBe(false);
	});

	it("leaves other 400s, busy models, rate limits and plain errors to the retries", () => {
		// A 400 about our own request, not the CV: it may pass on a retry or after a fix.
		expect(isUnreadableFileError(apiError(400, "Request contains an invalid argument."))).toBe(false);
		const badPayload = apiError(400, "Bad Request", geminiBody('Invalid JSON payload received. Unknown name "foo"'));
		expect(isUnreadableFileError(badPayload)).toBe(false);
		// The step backoff can outlast a per-minute limit, so 429 is retried too.
		for (const statusCode of [429, 500, 503]) expect(isUnreadableFileError(apiError(statusCode))).toBe(false);
		expect(isUnreadableFileError(apiError(429, "Quota exceeded for the document upload"))).toBe(false);
		expect(isUnreadableFileError(new AISDKError({ name: "GOOGLE_FILES_UPLOAD_ERROR", message: "503" }))).toBe(false);
		expect(isUnreadableFileError(new Error("network down"))).toBe(false);
	});
});

// A queued CV of any company, with the queue columns set directly.
async function seedQueued(
	org: string,
	{ priorityAt = Date.now(), updatedAt = new Date(), status = "queued" as "queued" | "scoring" } = {},
) {
	const id = crypto.randomUUID();
	await db.insert(candidates).values({
		id,
		orgId: org,
		jobId: org === orgId ? jobId : `job-${org}`,
		fileKey: `${org}/${id}.pdf`,
		fileName: "cv.pdf",
		fileSize: 1,
		createdBy: "user_admin",
		status,
		queuePriorityAt: new Date(priorityAt),
		updatedAt,
	});
	return id;
}

describe("the reading queue", () => {
	let otherOrg: string;
	let thirdOrg: string;

	beforeAll(async () => {
		otherOrg = (await createOrgForUser(db, "user_other", "Other")).org.id;
		thirdOrg = (await createOrgForUser(db, "user_third", "Third")).org.id;
		for (const org of [otherOrg, thirdOrg]) {
			await db.insert(jobs).values({
				id: `job-${org}`,
				orgId: org,
				createdBy: "user_admin",
				title: "Role",
				description: "A role description that is long enough",
				status: "open",
			});
		}
	});

	// Every test begins with an empty queue.
	beforeEach(async () => {
		await db.delete(candidates);
	});

	it("takes a slot (queued to scoring), and says so when the candidate is gone", async () => {
		const id = await seedCandidate();
		expect(await takeSlot(db, id)).toBe("started");
		expect((await rowOf(id)).status).toBe("scoring");
		// A retried step finds the CV already scoring and still succeeds.
		expect(await takeSlot(db, id)).toBe("started");
		expect(await takeSlot(db, "deleted")).toBe("gone");
	});

	it("lets a company read five CVs at a time and holds the sixth", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		const sixth = await seedQueued(orgId);
		const other = await seedQueued(otherOrg);

		expect(await takeSlot(db, sixth)).toBe("waiting");
		expect((await rowOf(sixth)).status).toBe("queued");
		// Another company is not held up by it.
		expect(await takeSlot(db, other)).toBe("started");
	});

	it("frees a slot when a CV is scored or failed", async () => {
		const running = await Promise.all(Array.from({ length: 5 }, () => seedQueued(orgId, { status: "scoring" })));
		const waiting = await seedQueued(orgId);
		expect(await takeSlot(db, waiting)).toBe("waiting");

		await markFailed(db, running[0], "x");
		expect(await takeSlot(db, waiting)).toBe("started");
	});

	it("holds back everyone once ten CVs are being read across companies", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		for (let i = 0; i < 5; i++) await seedQueued(otherOrg, { status: "scoring" });
		const third = await seedQueued(thirdOrg);
		expect(await takeSlot(db, third)).toBe("waiting");
	});

	it("serves the better place first when slots are scarce", async () => {
		// Nine reading, one slot left, and two waiters from different companies.
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		for (let i = 0; i < 4; i++) await seedQueued(otherOrg, { status: "scoring" });
		const now = Date.now();
		const early = await seedQueued(otherOrg, { priorityAt: now - 300_000 });
		const late = await seedQueued(thirdOrg, { priorityAt: now });

		expect(await takeSlot(db, late)).toBe("waiting");
		expect(await takeSlot(db, early)).toBe("started");
	});

	it("keeps the slot a retried step already took, even with a better waiter queued since", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		for (let i = 0; i < 3; i++) await seedQueued(otherOrg, { status: "scoring" });
		const now = Date.now();
		const mine = await seedQueued(thirdOrg, { priorityAt: now });
		expect(await takeSlot(db, mine)).toBe("started");
		// D1's answer to that step was lost, and a Max CV with a 30-minute head start began waiting meanwhile.
		await seedQueued(otherOrg, { priorityAt: now - 1_800_000 });
		expect(await takeSlot(db, mine)).toBe("started");
		expect((await rowOf(mine)).status).toBe("scoring");
	});

	it("does not let a better waiter whose own company is full block others", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		const now = Date.now();
		await seedQueued(orgId, { priorityAt: now - 600_000 });
		const other = await seedQueued(otherOrg, { priorityAt: now });
		expect(await takeSlot(db, other)).toBe("started");
	});

	it("ignores a waiter that stopped refreshing, and a scoring row that went stale", async () => {
		const now = Date.now();
		await seedQueued(otherOrg, { priorityAt: now - 600_000, updatedAt: new Date(now - WAITER_LIVE_MS - 5_000) });
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring", updatedAt: new Date(now - 21 * 60_000) });
		const id = await seedQueued(orgId, { priorityAt: now });
		expect(await takeSlot(db, id)).toBe("started");
	});

	it("breaks a tie by id, so two equal waiters never both wait or both go", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		for (let i = 0; i < 4; i++) await seedQueued(otherOrg, { status: "scoring" });
		const at = Date.now();
		const ids = [await seedQueued(otherOrg, { priorityAt: at }), await seedQueued(thirdOrg, { priorityAt: at })].sort();
		expect(await takeSlot(db, ids[1])).toBe("waiting");
		expect(await takeSlot(db, ids[0])).toBe("started");
	});

	it("refreshes updated_at while a CV waits, so the stale rule leaves it alone", async () => {
		for (let i = 0; i < 5; i++) await seedQueued(orgId, { status: "scoring" });
		const old = new Date(Date.now() - 19 * 60_000);
		const id = await seedQueued(orgId, { updatedAt: old });
		expect(await takeSlot(db, id)).toBe("waiting");
		expect((await rowOf(id)).updatedAt.getTime()).toBeGreaterThan(old.getTime() + 60_000);
	});

	it("puts a CV ahead by its plan's head start", async () => {
		const [free, pro, max] = [orgId, otherOrg, thirdOrg];
		await db.update(organizations).set({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: 1_900_000_000_000 }).where(eq(organizations.id, pro));
		await db.update(organizations).set({ plan: "max", subscriptionStatus: "active", currentPeriodEnd: 1_900_000_000_000 }).where(eq(organizations.id, max));
		const ids = [await seedQueued(free), await seedQueued(pro), await seedQueued(max)];
		const now = 1_800_000_000_000;
		for (const id of ids) expect(await enterQueue(db, id, now)).toBe(true);
		const at = await Promise.all(ids.map(async (id) => (await rowOf(id)).queuePriorityAt?.getTime()));
		expect(at).toEqual([now, now - 300_000, now - 1_800_000]);
		// A paid plan past its period and the renewal grace counts as Free.
		await db.update(organizations).set({ currentPeriodEnd: now - RENEWAL_GRACE_MS - 1 }).where(eq(organizations.id, max));
		await enterQueue(db, ids[2], now);
		expect((await rowOf(ids[2])).queuePriorityAt?.getTime()).toBe(now);
		expect(await enterQueue(db, "deleted")).toBe(false);
	});

	it("names a full queue in the failure message", () => {
		expect(failureMessage(new QueueTimeoutError("x"))).toBe(QUEUE_FULL_MESSAGE);
	});
});

describe("scoreCandidate", () => {
	it("reads the PDF from R2 against the job's requirements still on it, and returns small JSON", async () => {
		const id = await seedCandidate();
		const output = await scoreCandidate(db, bucket, scorer, id);

		expect(output).toEqual({ result: score, usage: { inputTokens: 1200, outputTokens: 340 } });
		expect(scorerCalls).toHaveLength(1);
		expect(scorerCalls[0]).toMatchObject({
			jobTitle: "Senior iOS Engineer",
			jobDescription: "Swift 5+ years, SwiftUI. Figma is a plus.",
			rubric: VISIBLE,
		});
		expect(scorerCalls[0]).not.toHaveProperty("onlyIds");
		expect(scorerCalls[0].pdf).toEqual(PDF);
		// Reading the CV doesn't change the candidate.
		expect((await rowOf(id)).status).toBe("queued");
	});

	it("reads a re-read against every requirement too", async () => {
		const id = await seedCandidate({ status: "scoring", evidence: { r1: { level: "none", quote: "" } } });
		await scoreCandidate(db, bucket, scorer, id, "reread");
		expect(scorerCalls[0].rubric).toEqual(VISIBLE);
		expect(scorerCalls[0]).not.toHaveProperty("onlyIds");
	});

	it("reads only the requirements a Check all run was missing, leaving out any removed since", async () => {
		const id = await seedCandidate({ status: "scored", evidence: {}, checkState: "checking", checkIds: ["r3", "r5", "r4"] });
		await scoreCandidate(db, bucket, scorer, id, "check");
		expect(scorerCalls[0]).toMatchObject({ rubric: VISIBLE, onlyIds: ["r3", "r4"] });
	});

	it("makes no Gemini call for a Check all run with nothing left to read", async () => {
		const id = await seedCandidate({ status: "scored", evidence: {}, checkState: "checking", checkIds: ["r5"] });
		const output = await scoreCandidate(db, bucket, scorer, id, "check");
		expect(output).toMatchObject({ result: { evidence: {} }, usage: null });
		expect(scorerCalls).toEqual([]);
	});

	it("stops quietly when a Check all run was dropped", async () => {
		const id = await seedCandidate({ status: "queued", evidence: null, checkState: null });
		await expect(scoreCandidate(db, bucket, scorer, id, "check")).resolves.toBeNull();
		expect(scorerCalls).toEqual([]);
	});

	it("turns missing token counts into nulls, so the step output is plain JSON", async () => {
		const id = await seedCandidate();
		const noUsage: CvScorer = async () => ({ value: score, inputTokens: undefined, outputTokens: undefined });
		expect((await scoreCandidate(db, bucket, noUsage, id))?.usage).toEqual({ inputTokens: null, outputTokens: null });
	});

	it("fails without a retry when the R2 object is missing, never calls Gemini and books no usage", async () => {
		const id = await seedCandidate({ withFile: false });
		const mark = await usageMark();
		const failure = await scoreCandidate(db, bucket, scorer, id).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(PermanentScoringError);
		expect((failure as Error).message).toBe("The uploaded file is missing");
		expect(scorerCalls).toEqual([]);
		expect(await usageSince(mark)).toEqual([]);
	});

	it("stops quietly, with nothing booked, when the candidate was deleted", async () => {
		const mark = await usageMark();
		await expect(scoreCandidate(db, bucket, scorer, "deleted")).resolves.toBeNull();
		expect(await usageSince(mark)).toEqual([]);
	});

	it("fails without a retry when Gemini says the document is unreadable, and books the call", async () => {
		const id = await seedCandidate();
		const mark = await usageMark();
		scorerError = apiError(400, "The document has no pages.");
		await expect(scoreCandidate(db, bucket, scorer, id)).rejects.toBeInstanceOf(PermanentScoringError);
		expect(await usageSince(mark)).toMatchObject([{ orgId, jobId, userId: "user_admin", operation: "cv_score", ok: false }]);
	});

	it("passes other errors through untouched, so the step retries them, booking each failed call", async () => {
		const id = await seedCandidate();
		const mark = await usageMark();
		for (const error of [apiError(503), apiError(429), apiError(400, "Request contains an invalid argument.")]) {
			scorerError = error;
			const failure = await scoreCandidate(db, bucket, scorer, id).catch((caught: unknown) => caught);
			expect(failure).toBe(error);
			expect(failure).not.toBeInstanceOf(PermanentScoringError);
		}
		expect(await usageSince(mark)).toMatchObject([{ ok: false }, { ok: false }, { ok: false }]);
	});
});

describe("saveScore", () => {
	it("stores the evidence with the score worked out in SQL from the job's requirements, and records the usage", async () => {
		const id = await seedCandidate();
		await takeSlot(db, id);
		const mark = await usageMark();
		await saveScore(db, id, { result: score, usage: { inputTokens: 1200, outputTokens: 340 } });

		// Swift clear (3), SwiftUI partial (1.5), Figma partial (0.5) and Kotlin none, out of 8: 62.5, rounded up.
		const row = await rowOf(id);
		expect(row).toMatchObject({
			status: "scored",
			score: 63,
			name: "Ada Lovelace",
			headline: "Senior iOS Engineer · London",
			summary: score.summary,
			error: null,
			evidence,
			profile: score.profile,
			checkState: null,
		});
		expect(row.scoredAt).toBeInstanceOf(Date);

		expect(await usageSince(mark)).toMatchObject([
			{
				orgId,
				jobId,
				userId: "user_admin",
				operation: "cv_score",
				model: GEMINI_TEXT_MODEL,
				ok: true,
				inputTokens: 1200,
				outputTokens: 340,
			},
		]);
	});

	it("scores against the weights as they are at save time, so a change made while Gemini was reading counts", async () => {
		const id = await seedCandidate();
		await scoreCandidate(db, bucket, scorer, id);
		// The recruiter turns Kotlin into a must-have and Figma off while the CV is being read.
		const changed = RUBRIC.map((item) =>
			item.id === "r4" ? { ...item, weight: "must" as const } : item.id === "r3" ? { ...item, weight: "off" as const } : item,
		);
		await db.update(jobs).set({ rubric: changed }).where(eq(jobs.id, jobId));
		await saveScore(db, id, { result: score, usage: null });
		// Swift 3 + SwiftUI 1.5 + Kotlin 0, out of 9: 50.
		expect((await rowOf(id)).score).toBe(50);
	});

	it("replaces the evidence on a re-read, dropping what was read before", async () => {
		const id = await seedCandidate({ status: "scoring", evidence: { r5: { level: "clear", quote: "Combine" }, r1: { level: "none", quote: "" } } });
		await saveScore(db, id, { result: score, usage: null }, "reread");
		expect((await rowOf(id)).evidence).toEqual(evidence);
	});

	it("adds a Check all run's evidence to the CV's, leaves the rest of the CV alone and ends the run", async () => {
		const scoredAt = new Date(Date.now() - 3_600_000);
		const id = await seedCandidate({
			status: "scored",
			score: 60,
			scoredAt,
			name: "Ada",
			summary: "Kept.",
			evidence: { r1: evidence.r1, r2: evidence.r2 },
			checkState: "checking",
			checkIds: ["r3", "r4"],
		});
		const mark = await usageMark();
		const checked = { ...score, name: "", headline: "", summary: "", evidence: { r3: evidence.r3, r4: evidence.r4 } };
		await saveScore(db, id, { result: checked, usage: { inputTokens: 10, outputTokens: 2 } }, "check");

		const row = await rowOf(id);
		expect(row).toMatchObject({ status: "scored", score: 63, name: "Ada", summary: "Kept.", evidence, checkState: null, checkIds: null });
		expect(row.scoredAt).toEqual(scoredAt);
		expect(await usageSince(mark)).toMatchObject([{ operation: "cv_score", ok: true, inputTokens: 10 }]);
	});

	it("drops a Check all run's evidence once the run was dropped, but still books the call", async () => {
		const id = await seedCandidate({ status: "queued", evidence: { r1: evidence.r1 }, checkState: null });
		const mark = await usageMark();
		await saveScore(db, id, { result: { ...score, evidence: { r2: evidence.r2 } }, usage: { inputTokens: 1, outputTokens: 1 } }, "check");
		expect(await rowOf(id)).toMatchObject({ status: "queued", evidence: { r1: evidence.r1 } });
		expect(await usageSince(mark)).toMatchObject([{ ok: true }]);
	});

	it("clears an earlier failure and keeps a missing name and headline as null", async () => {
		const id = await seedCandidate();
		await markFailed(db, id, SCORING_FAILED_MESSAGE);
		const result = { ...score, name: "", headline: "" };
		await saveScore(db, id, { result, usage: { inputTokens: null, outputTokens: null } });
		expect(await rowOf(id)).toMatchObject({ status: "scored", error: null, name: null, headline: null });
	});

	it("keeps a name the recruiter gave instead of the one read from the CV", async () => {
		const id = await seedCandidate({ name: "Ada L." });
		await saveScore(db, id, { result: score, usage: { inputTokens: 1, outputTokens: 1 } });
		expect(await rowOf(id)).toMatchObject({ status: "scored", name: "Ada L." });
	});

	it("does nothing for a candidate deleted while Gemini was working", async () => {
		const mark = await usageMark();
		const usage = { inputTokens: 1, outputTokens: 1 };
		await expect(saveScore(db, "deleted", { result: score, usage })).resolves.toBeUndefined();
		await expect(saveScore(db, "deleted", { result: score, usage }, "check")).resolves.toBeUndefined();
		expect(await usageSince(mark)).toEqual([]);
	});
});

describe("markFailed", () => {
	it("records the message the recruiter will read, and no usage: that is booked per Gemini call", async () => {
		const id = await seedCandidate();
		const mark = await usageMark();
		await markFailed(db, id, UNREADABLE_MESSAGE);

		expect(await rowOf(id)).toMatchObject({ status: "failed", error: "We couldn't read this file as a CV." });
		expect(await usageSince(mark)).toEqual([]);
	});

	it("does nothing for a deleted candidate", async () => {
		await expect(markFailed(db, "deleted", SCORING_FAILED_MESSAGE)).resolves.toBeUndefined();
	});
});

describe("failureMessage", () => {
	it("blames the file for permanent failures and asks for another try otherwise", () => {
		const missing = new PermanentScoringError("The uploaded file is missing");
		expect(failureMessage(missing)).toBe("We couldn't read this file as a CV.");
		// What the Workflow engine hands back once a step threw NonRetryableError.
		const nonRetryable = new Error("The uploaded file is missing");
		nonRetryable.name = "NonRetryableError";
		expect(failureMessage(nonRetryable)).toBe("We couldn't read this file as a CV.");

		expect(failureMessage(new Error("high demand"))).toBe("Scoring failed. Try again.");
		expect(failureMessage("not even an error")).toBe("Scoring failed. Try again.");
	});

	it("asks for another try when the job's requirements couldn't be drafted", () => {
		expect(failureMessage(new RubricUnavailableError("x"))).toBe("We couldn't set up this job's requirements. Try again.");
	});
});

describe("Check all runs in the reading queue", () => {
	let otherOrg: string;

	beforeAll(async () => {
		otherOrg = (await createOrgForUser(db, "user_check", "Checkers")).org.id;
		await db.insert(jobs).values({
			id: `job-${otherOrg}`,
			orgId: otherOrg,
			createdBy: "user_check",
			title: "Role",
			description: "A role description that is long enough",
			status: "open",
		});
	});

	beforeEach(async () => {
		await db.delete(candidates);
	});

	// A scored CV with a "Check all" run, or a scoring run, in the given state.
	async function seedRun(
		org: string,
		run: { checkState?: "queued" | "checking"; status?: "queued" | "scoring" | "scored" },
		{ priorityAt = Date.now(), updatedAt = new Date() } = {},
	) {
		const id = crypto.randomUUID();
		await db.insert(candidates).values({
			id,
			orgId: org,
			jobId: org === orgId ? jobId : `job-${org}`,
			fileKey: `${org}/${id}.pdf`,
			fileName: "cv.pdf",
			fileSize: 1,
			createdBy: "user_admin",
			status: run.status ?? "scored",
			evidence: run.status && run.status !== "scored" ? null : { r1: evidence.r1 },
			checkState: run.checkState ?? null,
			queuePriorityAt: new Date(priorityAt),
			updatedAt,
		});
		return id;
	}

	it("moves check_state to checking and leaves the CV scored", async () => {
		const id = await seedRun(orgId, { checkState: "queued" });
		expect(await enterQueue(db, id, Date.now(), "check")).toBe(true);
		expect(await takeSlot(db, id, Date.now(), "check")).toBe("started");
		expect(await rowOf(id)).toMatchObject({ status: "scored", checkState: "checking" });
		// A retried step finds it already checking and still succeeds.
		expect(await takeSlot(db, id, Date.now(), "check")).toBe("started");
	});

	it("says gone when the run was dropped, even though the CV is still there", async () => {
		const id = await seedRun(orgId, {});
		expect(await enterQueue(db, id, Date.now(), "check")).toBe(false);
		expect(await takeSlot(db, id, Date.now(), "check")).toBe("gone");
		// And a CV being scored has no Check all run to take a slot for.
		const scoring = await seedRun(orgId, { status: "queued" });
		expect(await takeSlot(db, scoring, Date.now(), "check")).toBe("gone");
	});

	it("counts CVs being checked against the company's five", async () => {
		for (let i = 0; i < 3; i++) await seedRun(orgId, { status: "scoring" });
		for (let i = 0; i < 2; i++) await seedRun(orgId, { checkState: "checking" });
		const upload = await seedRun(orgId, { status: "queued" });
		const check = await seedRun(orgId, { checkState: "queued" });
		expect(await takeSlot(db, upload)).toBe("waiting");
		expect(await takeSlot(db, check, Date.now(), "check")).toBe("waiting");
		expect(await rowOf(check)).toMatchObject({ status: "scored", checkState: "queued" });
		// Another company is not held up by them.
		expect(await takeSlot(db, await seedRun(otherOrg, { checkState: "queued" }), Date.now(), "check")).toBe("started");
	});

	it("counts CVs being checked against the ten overall", async () => {
		for (let i = 0; i < 5; i++) await seedRun(orgId, { checkState: "checking" });
		for (let i = 0; i < 5; i++) await seedRun(otherOrg, { status: "scoring" });
		const third = (await createOrgForUser(db, `user_${crypto.randomUUID()}`, "Third")).org.id;
		await db.insert(jobs).values({ id: `job-${third}`, orgId: third, createdBy: "u", title: "Role", description: "Role" });
		expect(await takeSlot(db, await seedRun(third, { status: "queued" }))).toBe("waiting");
	});

	it("serves Check all runs and new CVs in one order", async () => {
		// Nine reading, one slot left: an earlier check run goes before a later upload, and the other way round.
		for (let i = 0; i < 5; i++) await seedRun(orgId, { status: "scoring" });
		for (let i = 0; i < 4; i++) await seedRun(otherOrg, { checkState: "checking" });
		const now = Date.now();
		const third = (await createOrgForUser(db, `user_${crypto.randomUUID()}`, "Third")).org.id;
		await db.insert(jobs).values({ id: `job-${third}`, orgId: third, createdBy: "u", title: "Role", description: "Role" });
		const earlyCheck = await seedRun(otherOrg, { checkState: "queued" }, { priorityAt: now - 300_000 });
		const lateUpload = await seedRun(third, { status: "queued" }, { priorityAt: now });
		expect(await takeSlot(db, lateUpload)).toBe("waiting");
		expect(await takeSlot(db, earlyCheck, now, "check")).toBe("started");

		await endCheck(db, earlyCheck);
		const lateCheck = await seedRun(otherOrg, { checkState: "queued" }, { priorityAt: now + 60_000 });
		expect(await takeSlot(db, lateCheck, now, "check")).toBe("waiting");
		expect(await takeSlot(db, lateUpload)).toBe("started");
	});

	it("frees the slot of a check run that went quiet", async () => {
		const quiet = new Date(Date.now() - 21 * 60_000);
		for (let i = 0; i < 5; i++) await seedRun(orgId, { checkState: "checking" }, { updatedAt: quiet });
		expect(await takeSlot(db, await seedRun(orgId, { status: "queued" }))).toBe("started");
	});

	it("ends a failed check run without touching the CV's score or status", async () => {
		const id = await seedRun(orgId, { checkState: "checking" });
		await db.update(candidates).set({ score: 70 }).where(eq(candidates.id, id));
		await endCheck(db, id);
		expect(await rowOf(id)).toMatchObject({ status: "scored", score: 70, error: null, checkState: null, checkIds: null });
	});
});

describe("the job's requirements before a run", () => {
	let launches: { params: DraftRubricParams; claimed: boolean }[];
	let launchWorks: boolean;
	const launch: DraftLauncher = async (params, { claimed }) => {
		launches.push({ params, claimed });
		return launchWorks;
	};

	beforeEach(() => {
		launches = [];
		launchWorks = true;
	});

	const setRubric = (values: Partial<typeof jobs.$inferInsert>) => db.update(jobs).set(values).where(eq(jobs.id, jobId));
	const versionOf = async () => (await db.select({ v: jobs.rubricVersion }).from(jobs).where(eq(jobs.id, jobId)))[0].v;

	it("goes ahead when they are ready, and starts nothing", async () => {
		const id = await seedCandidate();
		expect(await prepareRubric(db, launch, id)).toBe("ready");
		expect(launches).toEqual([]);
	});

	it("claims a draft for a job that has none, or whose last draft failed, and starts it", async () => {
		for (const status of ["none", "failed"] as const) {
			launches = [];
			await setRubric({ rubric: null, rubricStatus: status });
			const before = await versionOf();
			const id = await seedCandidate();
			expect(await prepareRubric(db, launch, id)).toBe("drafting");
			expect(await versionOf()).toBe(before + 1);
			expect(launches).toEqual([{ params: { jobId, version: before + 1, userId: "user_admin" }, claimed: true }]);
		}
	});

	it("makes sure a draft under way has its Workflow, without claiming another", async () => {
		await setRubric({ rubricStatus: "drafting" });
		const before = await versionOf();
		const id = await seedCandidate();
		expect(await prepareRubric(db, launch, id)).toBe("drafting");
		expect(await versionOf()).toBe(before);
		expect(launches).toEqual([{ params: { jobId, version: before, userId: "user_admin" }, claimed: false }]);
	});

	it("reports a draft that could not start as failed", async () => {
		await setRubric({ rubric: null, rubricStatus: "none" });
		launchWorks = false;
		expect(await prepareRubric(db, launch, await seedCandidate())).toBe("failed");
	});

	it("says gone for a deleted candidate and a dropped Check all run", async () => {
		expect(await prepareRubric(db, launch, "deleted")).toBe("gone");
		const id = await seedCandidate({ status: "scored", checkState: null });
		expect(await prepareRubric(db, launch, id, "check")).toBe("gone");
		expect(await readRubric(db, id, "check")).toBe("gone");
		expect(await readRubric(db, id)).toBe("ready");
	});
});

describe("runScoreCv", () => {
	let launches: { params: DraftRubricParams; claimed: boolean }[];
	const launchDraft: DraftLauncher = async (params, { claimed }) => {
		launches.push({ params, claimed });
		return true;
	};
	const deps = () => ({ db, bucket, scorer, launchDraft, nonRetryable });
	const setRubric = (values: Partial<typeof jobs.$inferInsert>) => db.update(jobs).set(values).where(eq(jobs.id, jobId));

	beforeEach(async () => {
		await db.delete(candidates);
		launches = [];
		scorerAnswer = "asked";
	});

	it("reads a new CV against the job's requirements and saves it scored", async () => {
		const id = await seedCandidate();
		const { step, names } = fakeStep();
		await runScoreCv(step, deps(), { candidateId: id, mode: "initial" });

		expect(names).toEqual(["rubric", "enter", "slot-0", "score", "save"]);
		expect(scorerCalls[0].rubric).toEqual(VISIBLE);
		const row = await rowOf(id);
		expect(row).toMatchObject({ status: "scored", score: 100, error: null });
		expect(Object.keys(row.evidence ?? {})).toEqual(["r1", "r2", "r3", "r4"]);
	});

	it("treats a run started before modes existed as a new CV", async () => {
		const id = await seedCandidate();
		await runScoreCv(fakeStep().step, deps(), { candidateId: id });
		expect(await rowOf(id)).toMatchObject({ status: "scored", score: 100 });
	});

	it("waits while the job's requirements are drafted, then reads against them", async () => {
		await setRubric({ rubric: null, rubricStatus: "none" });
		const id = await seedCandidate();
		let sleeps = 0;
		const { step, names } = fakeStep({
			onSleep: async () => {
				if (++sleeps === 3) await setRubric({ rubric: RUBRIC, rubricStatus: "ready" });
			},
		});
		await runScoreCv(step, deps(), { candidateId: id, mode: "initial" });

		expect(launches).toMatchObject([{ claimed: true, params: { jobId } }]);
		expect(names.slice(0, 7)).toEqual(["rubric", "rubric-wait-0", "rubric-0", "rubric-wait-1", "rubric-1", "rubric-wait-2", "rubric-2"]);
		expect(names.slice(7)).toEqual(["enter", "slot-0", "score", "save"]);
		expect((await rowOf(id)).status).toBe("scored");
	});

	it("fails the CV with a message to try again when the draft fails", async () => {
		await setRubric({ rubricStatus: "drafting" });
		const id = await seedCandidate();
		const { step, names } = fakeStep({ onSleep: () => setRubric({ rubricStatus: "failed" }).then(() => undefined) });
		await expect(runScoreCv(step, deps(), { candidateId: id, mode: "initial" })).rejects.toBeInstanceOf(RubricUnavailableError);

		expect(names).toEqual(["rubric", "rubric-wait-0", "rubric-0", "fail"]);
		expect(scorerCalls).toEqual([]);
		expect(await rowOf(id)).toMatchObject({ status: "failed", error: RUBRIC_FAILED_MESSAGE });
	});

	it("gives up on a draft that takes longer than five minutes", async () => {
		await setRubric({ rubricStatus: "drafting" });
		const id = await seedCandidate();
		const { step, names } = fakeStep();
		await expect(runScoreCv(step, deps(), { candidateId: id, mode: "initial" })).rejects.toBeInstanceOf(RubricUnavailableError);
		expect(names.filter((name) => name.startsWith("rubric-wait-"))).toHaveLength(RUBRIC_MAX_POLLS);
		expect(names.length).toBeLessThan(1024);
		expect(await rowOf(id)).toMatchObject({ status: "failed", error: RUBRIC_FAILED_MESSAGE });
	});

	it("re-reads a CV against every requirement and replaces its evidence", async () => {
		const id = await seedCandidate({
			status: "queued",
			runs: 2,
			score: 40,
			evidence: { r1: { level: "none", quote: "" }, r5: { level: "clear", quote: "Combine" } },
		});
		await runScoreCv(fakeStep().step, deps(), { candidateId: id, mode: "reread" });
		const row = await rowOf(id);
		expect(row).toMatchObject({ status: "scored", score: 100 });
		expect(Object.keys(row.evidence ?? {})).toEqual(["r1", "r2", "r3", "r4"]);
	});

	it("checks a scored CV for the requirements it misses, keeping it scored throughout", async () => {
		const id = await seedCandidate({
			status: "scored",
			score: 75,
			name: "Ada",
			evidence: { r1: evidence.r1, r2: { level: "clear", quote: "SwiftUI apps" } },
			checkState: "queued",
			checkIds: ["r3", "r4"],
		});
		const { step, names } = fakeStep();
		await runScoreCv(step, deps(), { candidateId: id, mode: "check" });

		expect(names).toEqual(["rubric", "enter", "slot-0", "score", "save"]);
		expect(scorerCalls[0].onlyIds).toEqual(["r3", "r4"]);
		const row = await rowOf(id);
		expect(row).toMatchObject({ status: "scored", score: 100, name: "Ada", checkState: null, checkIds: null });
		expect(row.evidence).toMatchObject({ r1: evidence.r1, r3: { level: "clear" }, r4: { level: "clear" } });
	});

	it("makes a Check all run wait for a reading slot like any CV", async () => {
		for (let i = 0; i < 5; i++) await seedCandidate({ withFile: false, status: "scoring" });
		const id = await seedCandidate({ status: "scored", evidence: { r1: evidence.r1 }, checkState: "queued", checkIds: ["r2"] });
		const { step, names } = fakeStep({
			// The company's other five CVs finish while this one waits.
			onSleep: () => db.update(candidates).set({ status: "scored" }).where(eq(candidates.status, "scoring")).then(() => undefined),
		});
		await runScoreCv(step, deps(), { candidateId: id, mode: "check" });
		expect(names).toEqual(["rubric", "enter", "slot-0", "wait-0", "slot-1", "score", "save"]);
		expect((await rowOf(id)).checkState).toBeNull();
	});

	it("ends a failed Check all run without failing the CV", async () => {
		const id = await seedCandidate({ status: "scored", score: 38, evidence: { r1: evidence.r1 }, checkState: "queued", checkIds: ["r2"] });
		scorerError = apiError(503);
		const { step, names } = fakeStep();
		await expect(runScoreCv(step, deps(), { candidateId: id, mode: "check" })).rejects.toBe(scorerError);
		// The Gemini step had its four tries.
		expect(names.filter((name) => name === "score")).toHaveLength(4);
		expect(names.at(-1)).toBe("fail");
		expect(await rowOf(id)).toMatchObject({ status: "scored", score: 38, error: null, checkState: null });
	});

	it("stops quietly when a Check all run was dropped before it began", async () => {
		const id = await seedCandidate({ status: "queued", checkState: null });
		const { step, names } = fakeStep();
		await runScoreCv(step, deps(), { candidateId: id, mode: "check" });
		expect(names).toEqual(["rubric"]);
		expect((await rowOf(id)).status).toBe("queued");
	});

	it("blames the file, without retrying, when it is missing", async () => {
		const id = await seedCandidate({ withFile: false });
		const { step, names } = fakeStep();
		await expect(runScoreCv(step, deps(), { candidateId: id, mode: "initial" })).rejects.toMatchObject({ name: "NonRetryableError" });
		expect(names.filter((name) => name === "score")).toHaveLength(1);
		expect(await rowOf(id)).toMatchObject({ status: "failed", error: UNREADABLE_MESSAGE });
	});
});
