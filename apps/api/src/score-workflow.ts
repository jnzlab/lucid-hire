import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { type CvScorer, scoreCvWithGemini } from "./cv-scorer.ts";
import { getDb } from "./db/client.ts";
import { startDraft } from "./rubric.ts";
import { type ScoreCvParams, runScoreCv } from "./scoring.ts";

export type { ScoreCvParams } from "./scoring.ts";

// Reads one CV against its job's requirements: one Gemini call, then the result is saved on the candidate. The run
// lives in scoring.ts so tests can drive it; this class only hands it the real step and bindings.
export class ScoreCvWorkflow extends WorkflowEntrypoint<Env, ScoreCvParams> {
	async run(event: Readonly<WorkflowEvent<ScoreCvParams>>, step: WorkflowStep) {
		const db = getDb(this.env.DB);
		const scorer: CvScorer = (input) => scoreCvWithGemini(this.env.GOOGLE_GENERATIVE_AI_API_KEY, input);
		await runScoreCv(
			step,
			{
				db,
				bucket: this.env.CVS,
				scorer,
				launchDraft: (params, options) => startDraft(this.env.DRAFT_RUBRIC, db, params, options),
				nonRetryable: (message) => new NonRetryableError(message),
			},
			event.payload,
		);
	}
}
