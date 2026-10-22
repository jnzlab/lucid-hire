import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { type CvScorer, scoreCvWithGemini } from "./cv-scorer.ts";
import { getDb } from "./db/client.ts";
import {
	PermanentScoringError,
	failureMessage,
	markFailed,
	markScoring,
	saveScore,
	scoreCandidate,
} from "./scoring.ts";

export type ScoreCvParams = { candidateId: string };

// Gemini often answers 503 "high demand" and takes 10 to 80 seconds, so the call gets its own retries.
const SCORE_STEP = {
	retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
	timeout: "3 minutes",
} as const;

// Scores one uploaded CV: one Gemini call, then the result is saved on the candidate. The logic lives in
// scoring.ts so tests can run it; this class only turns it into steps.
export class ScoreCvWorkflow extends WorkflowEntrypoint<Env, ScoreCvParams> {
	async run(event: Readonly<WorkflowEvent<ScoreCvParams>>, step: WorkflowStep) {
		const { candidateId } = event.payload;
		const db = getDb(this.env.DB);
		const scorer: CvScorer = (input) => scoreCvWithGemini(this.env.GOOGLE_GENERATIVE_AI_API_KEY, input);

		// Every failure from the first step on ends in the "fail" step, so a CV is never left queued or scoring.
		try {
			const started = await step.do("start", () => markScoring(db, candidateId));
			// The candidate was deleted before its run began.
			if (!started) return;

			const scored = await step.do("score", SCORE_STEP, async () => {
				try {
					return await scoreCandidate(db, this.env.CVS, scorer, candidateId);
				} catch (error) {
					if (error instanceof PermanentScoringError) throw new NonRetryableError(error.message);
					throw error;
				}
			});
			// The candidate was deleted while its run was under way.
			if (!scored) return;

			await step.do("save", async () => {
				await saveScore(db, candidateId, scored);
				return true;
			});
		} catch (error) {
			console.error(`[${candidateId}] scoring failed`, error);
			await step.do("fail", async () => {
				await markFailed(db, candidateId, failureMessage(error));
				return true;
			});
			// Leaves the instance errored in the dashboard, though the recruiter already sees the failure.
			throw error;
		}
	}
}
