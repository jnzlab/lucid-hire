import { Hono } from "hono";
import { type AiResult, recordAiUsage } from "./ai.ts";
import { getCandidate } from "./candidates.ts";
import { getDb } from "./db/client.ts";
import { type InterviewQuestion, type QuestionWriter, getQuestions, saveQuestions } from "./interview-questions.ts";
import { getJob } from "./jobs.ts";
import { takeAiRequest } from "./usage.ts";
import type { AppEnv } from "./types.ts";

const candidateNotFound = {
	error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
};

// The interview questions written for a candidate. Mounted inside jobRoutes, so they sit behind its session and
// company checks, and any role can read or write them.
export function questionRoutes({ write }: { write: QuestionWriter }) {
	const routes = new Hono<AppEnv>().basePath("/:jobId/candidates/:id/questions");

	routes.get("/", async (c) => {
		const saved = await getQuestions(getDb(c.env.DB), c.get("org").id, c.req.param("jobId"), c.req.param("id"));
		if (!saved) return c.json(candidateNotFound, 404);
		return c.json(saved, 200, { "Cache-Control": "no-store" });
	});

	// Writes a new set from the scoring, replacing any earlier one. Capped per company by AI_RATE_LIMIT (a burst
	// guard) and by the plan's hourly allowance, and every call is metered.
	routes.post("/", async (c) => {
		const org = c.get("org");
		const db = getDb(c.env.DB);
		const jobId = c.req.param("jobId");

		const candidate = await getCandidate(db, org.id, jobId, c.req.param("id"));
		if (!candidate) return c.json(candidateNotFound, 404);
		if (candidate.status !== "scored") {
			return c.json(
				{ error: { code: "not_scored", message: "Questions can be written once the CV is scored" } },
				409,
			);
		}

		const { success } = await c.env.AI_RATE_LIMIT.limit({ key: org.id });
		if (!success) {
			return c.json(
				{ error: { code: "rate_limited", message: "That's 10 AI requests this minute. Try again in a minute." } },
				429,
			);
		}
		const overHourly = await takeAiRequest(db, org.id);
		if (overHourly) return c.json(overHourly.body, 429, overHourly.headers);

		// The candidate is in this company's job, so a missing job means it was deleted a moment ago.
		const job = await getJob(db, org.id, jobId);
		if (!job) return c.json(candidateNotFound, 404);

		const usage = { orgId: org.id, userId: c.get("userId"), jobId, operation: "interview_questions" };
		let result: AiResult<InterviewQuestion[]>;
		try {
			result = await write(c.env, {
				jobTitle: job.title,
				jobDescription: job.description,
				name: candidate.name,
				headline: candidate.headline,
				summary: candidate.summary,
				requirements: candidate.requirements ?? [],
			});
		} catch (error) {
			console.error(`[${c.get("requestId")}] interview questions failed`, error);
			c.executionCtx.waitUntil(recordAiUsage(db, { ...usage, ok: false }));
			return c.json(
				{ error: { code: "ai_failed", message: "We couldn't write questions right now. Try again." } },
				502,
			);
		}
		// Booked before saving: the call was made and paid for even if the save fails.
		c.executionCtx.waitUntil(
			recordAiUsage(db, { ...usage, ok: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens }),
		);

		let generatedAt: Date;
		try {
			generatedAt = await saveQuestions(db, {
				candidateId: candidate.id,
				orgId: org.id,
				jobId,
				userId: c.get("userId"),
				questions: result.value,
			});
		} catch (error) {
			// The only expected failure: the candidate was deleted while Gemini was writing, so the row has nothing to
			// point at.
			console.error(`[${c.get("requestId")}] saving interview questions failed`, error);
			return c.json(candidateNotFound, 404);
		}
		return c.json({ questions: result.value, generatedAt });
	});

	return routes;
}
