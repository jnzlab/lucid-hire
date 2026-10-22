import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The API Worker, published on its own domain. The frontend on lucidhire.io calls it cross-origin.
export default defineConfig({
	worker: {
		name: "lucidhire-api",
		compatibilityDate: "2026-10-19",
		entrypoint,
		observability: { enabled: true },
		// Scores one uploaded CV with Gemini. The retries and the 10 ms CPU cap per step are why it is a Workflow.
		exports: { ScoreCvWorkflow: exports.workflow({ name: "lucidhire-score-cv" }) },
		env: {
			CLERK_SECRET_KEY: bindings.secret(),
			// Gemini, for every AI call (gemini-3.5-flash-lite text, gemini-embedding-2 embeddings).
			GOOGLE_GENERATIVE_AI_API_KEY: bindings.secret(),
			// Turnstile secret key for the public apply form; the site key is public and lives in the web app.
			TURNSTILE_SECRET_KEY: bindings.secret(),
			// Polar billing (sandbox): the API token for checkouts and the portal, and the signing secret of the webhook.
			POLAR_ACCESS_TOKEN: bindings.secret(),
			POLAR_WEBHOOK_SECRET: bindings.secret(),
			// lucidhire-db, primary in US East. Migrations live in ./migrations (see package.json).
			DB: bindings.d1({ id: "c6c2834b-6af0-4a1b-9799-9dd0a58b13d5", name: "lucidhire-db" }),
			// Caps request-facing AI calls (such as "Improve with AI") per company: 10 a minute.
			AI_RATE_LIMIT: bindings.rateLimit({ namespace: "1001", simple: { limit: 10, period: 60 } }),
			// Caps applications from the public page: 5 a minute per visitor and job.
			APPLY_RATE_LIMIT: bindings.rateLimit({ namespace: "1002", simple: { limit: 5, period: 60 } }),
			// Private bucket for uploaded CVs, keyed `<orgId>/<jobId>/<candidateId>.pdf`.
			CVS: bindings.r2({ name: "lucidhire-cvs" }),
			// Starts one scoring run per CV (ScoreCvWorkflow above, in this same Worker).
			SCORE_CV: bindings.workflow({
				name: "lucidhire-score-cv",
				worker: "lucidhire-api",
				exportName: "ScoreCvWorkflow",
			}),
		},
		domains: ["api.lucidhire.io"],
		workersDev: false,
		previewUrls: false,
	},
});
