import { AISDKError, APICallError, RetryError } from "ai";
import { desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	type CvScore,
	type CvScoreInput,
	type CvScorer,
	cvScoreSchema,
	isUnreadableFileError,
	tidyCvScore,
} from "./cv-scorer.ts";
import { GEMINI_TEXT_MODEL } from "./ai.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs, organizations, usageCounters } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import {
	PermanentScoringError,
	SCORING_FAILED_MESSAGE,
	UNREADABLE_MESSAGE,
	failureMessage,
	markFailed,
	QUEUE_FULL_MESSAGE,
	QueueTimeoutError,
	WAITER_LIVE_MS,
	enterQueue,
	takeSlot,
	saveScore,
	scoreCandidate,
} from "./scoring.ts";
import { createTestD1 } from "./test/d1.ts";
import { RENEWAL_GRACE_MS } from "./plan-state.ts";

let db: Db;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let orgId: string;
let jobId: string;
let scorerCalls: CvScoreInput[];
let scorerError: unknown;

const PDF = new TextEncoder().encode("%PDF-1.4 a small CV");

const score: CvScore = {
	name: "Ada Lovelace",
	headline: "Senior iOS Engineer · London",
	summary: "Ada has six years of Swift and ships SwiftUI apps. She has no Combine experience.",
	requirements: [
		{ label: "Swift", requirement: "5+ years of Swift", importance: "must", met: true, evidence: "Six years of Swift" },
		{ label: "SwiftUI", requirement: "SwiftUI", importance: "must", met: true, evidence: "Built the app in SwiftUI" },
		{ label: "Combine", requirement: "Combine", importance: "must", met: false, evidence: "" },
		{ label: "Figma", requirement: "Figma", importance: "nice", met: true, evidence: "Handed off designs in Figma" },
		{ label: "Kotlin", requirement: "Kotlin", importance: "nice", met: false, evidence: "" },
	],
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

const scorer: CvScorer = async (input) => {
	scorerCalls.push(input);
	if (scorerError) throw scorerError;
	return { value: score, inputTokens: 1200, outputTokens: 340 };
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
		description: "Swift 5+ years, SwiftUI, Combine. Figma is a plus.",
		status: "open",
	});
});

afterAll(() => dispose());

beforeEach(async () => {
	// Every test starts with a fresh monthly job allowance.
	await db.delete(usageCounters);
	scorerCalls = [];
	scorerError = undefined;
});

// A queued candidate, with its PDF in R2 unless `withFile` is false.
async function seedCandidate({ withFile = true, name }: { withFile?: boolean; name?: string } = {}) {
	const id = crypto.randomUUID();
	const fileKey = `${orgId}/${jobId}/${id}.pdf`;
	await db
		.insert(candidates)
		.values({ id, orgId, jobId, fileKey, fileName: "ada.pdf", fileSize: PDF.byteLength, createdBy: "user_admin", name });
	if (withFile) await bucket.put(fileKey, PDF);
	return id;
}

const rowOf = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];

// ai_usage rows are shared by every test here, so each test looks only at the rows written after it began.
const usageMark = async () => (await db.select().from(aiUsage).orderBy(desc(aiUsage.id)).limit(1))[0]?.id ?? 0;
const usageSince = (mark: number) => db.select().from(aiUsage).where(gt(aiUsage.id, mark));

describe("cvScoreSchema", () => {
	it("accepts a realistic result", () => {
		expect(cvScoreSchema.safeParse(score).success).toBe(true);
		// A CV with no name is allowed: the model answers with an empty string.
		expect(cvScoreSchema.safeParse({ ...score, name: "" }).success).toBe(true);
	});

	it("leaves the cap of 12 requirements to tidyCvScore, so a 13th doesn't cost the whole response", () => {
		const thirteen = Array.from({ length: 13 }, () => score.requirements[0]);
		expect(cvScoreSchema.safeParse({ ...score, requirements: thirteen }).success).toBe(true);
	});

	it("rejects results the model got wrong", () => {
		const [first, ...rest] = score.requirements;
		const bad = [
			{ ...score, requirements: [{ ...first, importance: "maybe" }, ...rest] },
			{ ...score, requirements: [{ ...first, met: "yes" }, ...rest] },
			{ ...score, requirements: [{ label: "Swift", requirement: "Swift", importance: "must", met: true }, ...rest] },
			{ ...score, requirements: [] },
			{ name: "Ada", headline: "x", summary: "x" },
		];
		for (const value of bad) expect(cvScoreSchema.safeParse(value).success).toBe(false);
	});
});

describe("tidyCvScore", () => {
	it("clips long text, and drops evidence for unmet requirements", () => {
		const long = "x".repeat(500);
		const tidy = tidyCvScore({
			name: `  ${score.name} `,
			headline: score.headline,
			summary: score.summary,
			requirements: [
				{ ...score.requirements[0], evidence: long },
				{ ...score.requirements[2], evidence: "Combine was never mentioned" },
				score.requirements[3],
			],
		});
		expect(tidy.name).toBe("Ada Lovelace");
		expect(tidy.requirements[0].evidence).toHaveLength(200);
		expect(tidy.requirements[1].evidence).toBe("");
		expect(tidy.requirements[2]).toEqual(score.requirements[3]);
	});

	it("keeps at most 12 requirements", () => {
		const thirteen = Array.from({ length: 13 }, (_, i) => ({ ...score.requirements[0], label: `Skill ${i}` }));
		const tidy = tidyCvScore({ ...score, requirements: thirteen });
		expect(tidy.requirements).toHaveLength(12);
		expect(tidy.requirements.at(-1)?.label).toBe("Skill 11");
	});

	it("counts a requirement as met only when it comes with a quote", () => {
		const [first, second] = score.requirements;
		const tidy = tidyCvScore({
			...score,
			requirements: [
				{ ...first, met: true, evidence: "" },
				{ ...second, met: true, evidence: "   " },
				{ ...second, met: true, evidence: "Built the app in SwiftUI" },
			],
		});
		expect(tidy.requirements.map((r) => r.met)).toEqual([false, false, true]);
		expect(tidy.requirements.map((r) => r.evidence)).toEqual(["", "", "Built the app in SwiftUI"]);
	});
});

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
	it("reads the PDF from R2, scores it against the job and returns small JSON", async () => {
		const id = await seedCandidate();
		const output = await scoreCandidate(db, bucket, scorer, id);

		expect(output).toEqual({ result: score, usage: { inputTokens: 1200, outputTokens: 340 } });
		expect(scorerCalls).toHaveLength(1);
		expect(scorerCalls[0]).toMatchObject({
			jobTitle: "Senior iOS Engineer",
			jobDescription: "Swift 5+ years, SwiftUI, Combine. Figma is a plus.",
		});
		expect(scorerCalls[0].pdf).toEqual(PDF);
		// Reading the CV doesn't change the candidate.
		expect((await rowOf(id)).status).toBe("queued");
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
	it("stores the result with the score we computed, and records the usage", async () => {
		const id = await seedCandidate();
		await takeSlot(db, id);
		const mark = await usageMark();
		await saveScore(db, id, { result: score, usage: { inputTokens: 1200, outputTokens: 340 } });

		// 2 of 3 must-haves (4 points) and 1 of 2 nice-to-haves (1 point) out of 8: 62.5, rounded up.
		const row = await rowOf(id);
		expect(row).toMatchObject({
			status: "scored",
			score: 63,
			name: "Ada Lovelace",
			headline: "Senior iOS Engineer · London",
			summary: score.summary,
			error: null,
			requirements: score.requirements,
			profile: score.profile,
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
});
