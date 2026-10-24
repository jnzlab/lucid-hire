import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getDb } from "./db/client.ts";
import { type DraftRubricParams, runDraftRubric } from "./rubric.ts";
import { draftRubricWithGemini } from "./rubric-drafter.ts";

// Drafts one job's list of requirements with Gemini: one call with retries, then the list is saved on the job and its
// scored CVs re-scored. The run lives in rubric.ts so tests can drive it; this class only hands it the real step and
// bindings.
export class DraftRubricWorkflow extends WorkflowEntrypoint<Env, DraftRubricParams> {
	async run(event: Readonly<WorkflowEvent<DraftRubricParams>>, step: WorkflowStep) {
		await runDraftRubric(
			step,
			{
				db: getDb(this.env.DB),
				drafter: (input) => draftRubricWithGemini(this.env.GOOGLE_GENERATIVE_AI_API_KEY, input),
			},
			event.payload,
		);
	}
}
