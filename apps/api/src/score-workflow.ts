import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { type CvScorer, scoreCvWithGemini } from "./cv-scorer.ts";
import { getDb } from "./db/client.ts";
import {
	PermanentScoringError,
	failureMessage,
	markFailed,
	QueueTimeoutError,
	type SlotResult,
	enterQueue,
	saveScore,
	scoreCandidate,
	takeSlot,
} from "./scoring.ts";

export type ScoreCvParams = { candidateId: string };

// Gemini often answers 503 "high demand" and takes 10 to 80 seconds, so the call gets its own retries.
const SCORE_STEP = {
	retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
	timeout: "3 minutes",
} as const;

// A waiting CV looks for a free slot every 10 seconds, for up to 30 minutes. Each round is two steps (a check and
// a sleep), so even this stays far below the 1024 steps an instance may have.
export const QUEUE_POLL = "10 seconds";
export const QUEUE_MAX_POLLS = 180;

// Scores one uploaded CV: one Gemini call, then the result is saved on the candidate. The logic lives in
// scoring.ts so tests can run it; this class only turns it into steps.
export class ScoreCvWorkflow extends WorkflowEntrypoint<Env, ScoreCvParams> {
	async run(event: Readonly<WorkflowEvent<ScoreCvParams>>, step: WorkflowStep) {
		const { candidateId } = event.payload;
		const db = getDb(this.env.DB);
		const scorer: CvScorer = (input) => scoreCvWithGemini(this.env.GOOGLE_GENERATIVE_AI_API_KEY, input);

		// Every failure from the first step on ends in the "fail" step, so a CV is never left queued or scoring.
		try {
			// The place in the reading queue is fixed once, then the CV waits for a slot (at most 5 per company and
			// 10 in all). Waiting refreshes `updated_at`, so the stale rule only catches runs whose Workflow is gone.
			const entered = await step.do("enter", () => enterQueue(db, candidateId));
			// The candidate was deleted before its run began.
			if (!entered) return;

			let slot: SlotResult = "waiting";
			for (let poll = 0; poll < QUEUE_MAX_POLLS && slot === "waiting"; poll++) {
				slot = await step.do(`slot-${poll}`, () => takeSlot(db, candidateId));
				if (slot === "waiting") await step.sleep(`wait-${poll}`, QUEUE_POLL);
			}
			if (slot === "gone") return;
			if (slot === "waiting") throw new QueueTimeoutError("No reading slot came free");

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
