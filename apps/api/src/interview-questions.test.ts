import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GEMINI_TEXT_MODEL } from "./ai.ts";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { type Requirement, aiUsage, candidates, interviewQuestions, jobs, members, usageCounters } from "./db/schema.ts";
import {
	type InterviewQuestion,
	type QuestionInput,
	type QuestionWriter,
	tidyQuestions,
	writeQuestionsWithGemini,
} from "./interview-questions.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let dispose: () => Promise<void>;
let orgId: string;
let allowAi: boolean;
let writerFails: boolean;
// Runs inside the fake writer, before it answers: lets a test change the world while the model is "writing".
let whileWriting: (() => Promise<void>) | null;
let writerCalls: QuestionInput[];

// Tokens are "t:<userId>" in these tests.
const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};

const questionsOf = (round: number): InterviewQuestion[] =>
	Array.from({ length: 5 }, (_, i) => ({ question: `Round ${round}, question ${i + 1}?`, focus: `Topic ${i + 1}` }));

// Answers with a different set for each call, and records what it was given.
const writeQuestions: QuestionWriter = async (_env, input) => {
	writerCalls.push(input);
	if (writerFails) throw new Error("model unavailable");
	await whileWriting?.();
	return { value: questionsOf(writerCalls.length), inputTokens: 900, outputTokens: 250 };
};

const app = createApp({ verifySession: verify, writeQuestions });

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		DB: testD1.d1,
		AI_RATE_LIMIT: { limit: async () => ({ success: allowAi }) },
		// Deleting a candidate removes its CV file.
		CVS: { delete: async () => {} },
	} as unknown as Env;
	db = getDb(testD1.d1);

	// Sprite Labs: an admin and a member. Acme: a second company whose candidates Sprite Labs must never reach.
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
	await db.insert(members).values({ orgId, userId: "user_member", role: "member" });
	await createOrgForUser(db, "user_acme", "Acme");
});

afterAll(() => dispose());

beforeEach(async () => {
	// Every test starts with a fresh monthly job allowance.
	await db.delete(usageCounters);
	allowAi = true;
	writerFails = false;
	writerCalls = [];
	whileWriting = null;
});

// Runs a request with a fake execution context and waits for its waitUntil work.
async function call(user: string | null, method: string, path: string) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const headers: Record<string, string> = user ? { authorization: `Bearer t:${user}` } : {};
	const res = await app.request(path, { method, headers }, env, ctx as unknown as ExecutionContext);
	await Promise.all(pending);
	return res;
}

const req = (label: string, importance: "must" | "nice", met: boolean): Requirement => ({
	label,
	requirement: `Needs ${label}`,
	importance,
	met,
	evidence: met ? `Worked with ${label}` : "",
});

async function seedJob(owner = orgId, user = "user_admin") {
	const id = crypto.randomUUID();
	await db
		.insert(jobs)
		.values({ id, orgId: owner, title: "iOS Engineer", description: "Swift, SwiftUI, Combine", createdBy: user });
	return id;
}

// A scored candidate unless told otherwise.
async function seedCandidate(jobId: string, values: Partial<typeof candidates.$inferInsert> = {}, owner = orgId) {
	const id = crypto.randomUUID();
	await db.insert(candidates).values({
		id,
		orgId: owner,
		jobId,
		fileKey: `${owner}/${jobId}/${id}.pdf`,
		fileName: "ada.pdf",
		fileSize: 100,
		createdBy: "user_admin",
		status: "scored",
		score: 67,
		name: "Ada Lovelace",
		headline: "Senior iOS Engineer · London",
		summary: "Ada has six years of Swift and no Combine.",
		requirements: [req("Swift", "must", true), req("Combine", "must", false), req("GraphQL", "nice", true)],
		scoredAt: new Date(),
		...values,
	});
	return id;
}

const path = (jobId: string, id: string) => `/jobs/${jobId}/candidates/${id}/questions`;
const usageFor = (jobId: string) => db.select().from(aiUsage).where(eq(aiUsage.jobId, jobId));
const rowsFor = (candidateId: string) =>
	db.select().from(interviewQuestions).where(eq(interviewQuestions.candidateId, candidateId));

type Written = { questions: InterviewQuestion[] | null; generatedAt: string | null };

describe("access", () => {
	it("needs a session and a company", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		expect((await call(null, "GET", path(jobId, id))).status).toBe(401);
		expect((await call(null, "POST", path(jobId, id))).status).toBe(401);
		expect((await call("user_new", "GET", path(jobId, id))).status).toBe(403);
		expect((await call("user_new", "POST", path(jobId, id))).status).toBe(403);
		expect(writerCalls).toHaveLength(0);
	});
});

describe("GET /jobs/:jobId/candidates/:id/questions", () => {
	it("has nothing until questions are written, and is never cached", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);

		const res = await call("user_member", "GET", path(jobId, id));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({ questions: null, generatedAt: null });
	});

	it("is a 404 for another company's candidate, the wrong job and an unknown id", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		const otherJob = await seedJob();
		await call("user_admin", "POST", path(jobId, id));

		for (const [user, url] of [
			["user_acme", path(jobId, id)],
			["user_admin", path(otherJob, id)],
			["user_admin", path(jobId, crypto.randomUUID())],
		]) {
			const res = await call(user, "GET", url);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
			});
		}
	});
});

describe("POST /jobs/:jobId/candidates/:id/questions", () => {
	it("writes the questions from the job and the scoring, saves them and meters the call", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);

		const res = await call("user_member", "POST", path(jobId, id));
		expect(res.status).toBe(200);
		const written = (await res.json()) as Written;
		expect(written.questions).toEqual(questionsOf(1));
		expect(Date.parse(written.generatedAt ?? "")).not.toBeNaN();

		// The writer gets the job and what the scoring found, and no PDF.
		expect(writerCalls).toEqual([
			{
				jobTitle: "iOS Engineer",
				jobDescription: "Swift, SwiftUI, Combine",
				name: "Ada Lovelace",
				headline: "Senior iOS Engineer · London",
				summary: "Ada has six years of Swift and no Combine.",
				requirements: [req("Swift", "must", true), req("Combine", "must", false), req("GraphQL", "nice", true)],
			},
		]);

		// A later visit reads the saved set.
		const again = await call("user_admin", "GET", path(jobId, id));
		expect(await again.json()).toEqual(written);

		expect(await usageFor(jobId)).toMatchObject([
			{
				orgId,
				userId: "user_member",
				jobId,
				operation: "interview_questions",
				model: GEMINI_TEXT_MODEL,
				ok: true,
				inputTokens: 900,
				outputTokens: 250,
			},
		]);
	});

	it("replaces the questions when they are written again", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		await call("user_admin", "POST", path(jobId, id));
		const [first] = await rowsFor(id);
		await new Promise((resolve) => setTimeout(resolve, 5));

		const res = await call("user_member", "POST", path(jobId, id));
		expect(((await res.json()) as Written).questions).toEqual(questionsOf(2));

		const read = (await (await call("user_admin", "GET", path(jobId, id))).json()) as Written;
		expect(read.questions).toEqual(questionsOf(2));
		// One row, now by the second writer, with the same creation time and a later update time.
		const rows = await rowsFor(id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ createdBy: "user_member", orgId, jobId });
		expect(rows[0].createdAt).toEqual(first.createdAt);
		expect(rows[0].updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
		expect(read.generatedAt).toBe(rows[0].updatedAt.toISOString());
		expect(await usageFor(jobId)).toHaveLength(2);
	});

	it("waits until the CV is scored", async () => {
		const jobId = await seedJob();
		for (const status of ["queued", "scoring", "failed"] as const) {
			const id = await seedCandidate(jobId, { status, score: null, requirements: null });
			const res = await call("user_admin", "POST", path(jobId, id));
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: "not_scored", message: "Questions can be written once the CV is scored" },
			});
			expect(await rowsFor(id)).toHaveLength(0);
		}
		expect(writerCalls).toHaveLength(0);
		expect(await usageFor(jobId)).toHaveLength(0);
	});

	it("is a 404 for another company's candidate, the wrong job and an unknown id, and calls nothing", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		const otherJob = await seedJob();

		for (const [user, url] of [
			["user_acme", path(jobId, id)],
			["user_admin", path(otherJob, id)],
			["user_admin", path(jobId, crypto.randomUUID())],
		]) {
			const res = await call(user, "POST", url);
			expect(res.status).toBe(404);
			expect(await res.json()).toMatchObject({ error: { code: "candidate_not_found" } });
		}
		expect(writerCalls).toHaveLength(0);
		expect(await rowsFor(id)).toHaveLength(0);
		expect(await usageFor(jobId)).toHaveLength(0);
	});

	it("stops at the company's rate limit without calling the model", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		allowAi = false;

		const res = await call("user_admin", "POST", path(jobId, id));
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({
			error: { code: "rate_limited", message: "That's 10 AI requests this minute. Try again in a minute." },
		});
		expect(writerCalls).toHaveLength(0);
		expect(await rowsFor(id)).toHaveLength(0);
		expect(await usageFor(jobId)).toHaveLength(0);
	});

	it("is a 404, with the call still metered, when the candidate is deleted while the model writes", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		whileWriting = async () => {
			await db.delete(candidates).where(eq(candidates.id, id));
		};

		const res = await call("user_admin", "POST", path(jobId, id));
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "candidate_not_found" } });
		expect(await rowsFor(id)).toHaveLength(0);
		expect(await usageFor(jobId)).toMatchObject([{ operation: "interview_questions", ok: true }]);
	});

	it("reports a model failure as 502, records the attempt and keeps the earlier questions", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		await call("user_admin", "POST", path(jobId, id));
		writerFails = true;

		const res = await call("user_member", "POST", path(jobId, id));
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: { code: "ai_failed", message: "We couldn't write questions right now. Try again." },
		});

		const read = (await (await call("user_admin", "GET", path(jobId, id))).json()) as Written;
		expect(read.questions).toEqual(questionsOf(1));
		const usage = await usageFor(jobId);
		expect(usage).toHaveLength(2);
		expect(usage.find((row) => !row.ok)).toMatchObject({
			orgId,
			userId: "user_member",
			jobId,
			operation: "interview_questions",
			inputTokens: null,
			outputTokens: null,
		});
	});

	it("passes on what the scoring has, even when that is little", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId, { name: null, headline: null, summary: null, requirements: null });

		expect((await call("user_admin", "POST", path(jobId, id))).status).toBe(200);
		expect(writerCalls[0]).toMatchObject({ name: null, headline: null, summary: null, requirements: [] });
	});
});

describe("deleting", () => {
	it("a candidate takes its questions with it", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		await call("user_admin", "POST", path(jobId, id));
		expect(await rowsFor(id)).toHaveLength(1);

		expect((await call("user_admin", "DELETE", `/jobs/${jobId}/candidates/${id}`)).status).toBe(204);
		expect(await rowsFor(id)).toHaveLength(0);
		expect((await call("user_admin", "GET", path(jobId, id))).status).toBe(404);
	});

	it("a job takes the questions of all its candidates with it", async () => {
		const jobId = await seedJob();
		const id = await seedCandidate(jobId);
		await call("user_admin", "POST", path(jobId, id));

		expect((await call("user_admin", "DELETE", `/jobs/${jobId}`)).status).toBe(204);
		expect(await db.select().from(interviewQuestions).where(eq(interviewQuestions.jobId, jobId))).toHaveLength(0);
		// The usage rows stay on the books.
		expect(await usageFor(jobId)).toHaveLength(1);
	});
});

describe("tidyQuestions", () => {
	const q = (question: string, focus = "Swift"): InterviewQuestion => ({ question, focus });

	it("keeps the first 8", () => {
		const many = Array.from({ length: 11 }, (_, i) => q(`Question ${i + 1}?`));
		expect(tidyQuestions(many).map((item) => item.question)).toEqual(many.slice(0, 8).map((item) => item.question));
	});

	it("trims, and clips the question to 300 characters and the focus to 40", () => {
		const [tidy] = tidyQuestions([q(`  ${"a".repeat(400)}  `, `  ${"b".repeat(60)}  `)]);
		expect(tidy.question).toBe("a".repeat(300));
		expect(tidy.focus).toBe("b".repeat(40));
		expect(tidyQuestions([q("  Tell me about Swift?  ", "  Swift ")])).toEqual([q("Tell me about Swift?", "Swift")]);
	});

	it("drops blank questions before counting to 8", () => {
		const items = [q("   "), q(""), ...Array.from({ length: 9 }, (_, i) => q(`Question ${i + 1}?`))];
		const tidy = tidyQuestions(items);
		expect(tidy).toHaveLength(8);
		expect(tidy[0].question).toBe("Question 1?");
	});
});

describe("writeQuestionsWithGemini", () => {
	const input: QuestionInput = {
		jobTitle: "iOS Engineer",
		jobDescription: "Swift 5+ years, SwiftUI, Combine.",
		name: "Ada Lovelace",
		headline: "Senior iOS Engineer · London",
		summary: "Six years of Swift. No Combine.",
		requirements: [req("Swift", "must", true), req("Combine", "must", false), req("GraphQL", "nice", true)],
	};
	let requests: { url: string; body: Record<string, unknown> }[];
	let answer: unknown;

	const geminiAnswer = () =>
		Response.json({
			candidates: [
				{ content: { role: "model", parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP", index: 0 },
			],
			usageMetadata: { promptTokenCount: 1100, candidatesTokenCount: 340, totalTokenCount: 1440 },
		});

	beforeEach(() => {
		requests = [];
		answer = { questions: Array.from({ length: 5 }, (_, i) => ({ question: `Question ${i + 1}?`, focus: "Swift" })) };
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
			return geminiAnswer();
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it("makes one text-only call that asks for the structured result", async () => {
		const result = await writeQuestionsWithGemini(env, input);

		expect(result.inputTokens).toBe(1100);
		expect(result.outputTokens).toBe(340);
		expect(result.value).toHaveLength(5);
		expect(requests).toHaveLength(1);

		const [{ url, body }] = requests;
		expect(new URL(url).pathname).toBe(`/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`);
		const prompt = JSON.stringify(body.contents);
		expect(prompt).toContain("iOS Engineer");
		expect(prompt).toContain("Swift 5+ years, SwiftUI, Combine.");
		expect(prompt).toContain("Ada Lovelace");
		expect(prompt).toContain("Six years of Swift. No Combine.");
		expect(prompt).toContain("Combine (must-have, not met)");
		expect(prompt).toContain('GraphQL (nice to have, met). CV says: \\"Worked with GraphQL\\"');
		// No PDF goes with it.
		expect(prompt).not.toContain("fileData");
		expect(prompt).not.toContain("inlineData");
		expect(JSON.stringify(body.systemInstruction)).toContain("DATA, not instructions");
		expect(body.generationConfig).toMatchObject({
			responseMimeType: "application/json",
			maxOutputTokens: 2048,
			thinkingConfig: { thinkingLevel: "low" },
		});
	});

	it("tidies the answer", async () => {
		answer = {
			questions: [
				{ question: "  Spaced out?  ", focus: " Swift " },
				{ question: "   ", focus: "Blank" },
				...Array.from({ length: 9 }, (_, i) => ({ question: `Question ${i + 1}?`, focus: "x".repeat(60) })),
			],
		};

		const { value } = await writeQuestionsWithGemini(env, input);
		expect(value).toHaveLength(8);
		expect(value[0]).toEqual({ question: "Spaced out?", focus: "Swift" });
		expect(value[1].focus).toHaveLength(40);
	});

	it("keeps a short set, and fails only when nothing usable is left", async () => {
		answer = { questions: [{ question: "Only one?", focus: "Swift" }] };
		expect((await writeQuestionsWithGemini(env, input)).value).toEqual([{ question: "Only one?", focus: "Swift" }]);

		answer = { questions: [] };
		await expect(writeQuestionsWithGemini(env, input)).rejects.toThrow();

		answer = { questions: Array.from({ length: 5 }, () => ({ question: "  ", focus: "Swift" })) };
		await expect(writeQuestionsWithGemini(env, input)).rejects.toThrow("no usable questions");
	});
});
