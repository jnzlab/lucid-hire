import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The API Worker, published on its own domain. The frontend on lucidhire.io calls it cross-origin.
export default defineConfig({
	worker: {
		name: "lucidhire-api",
		compatibilityDate: "2026-10-19",
		entrypoint,
		observability: { enabled: true },
		env: {
			CLERK_SECRET_KEY: bindings.secret(),
			// lucidhire-db, primary in US East. Migrations live in ./migrations (see package.json).
			DB: bindings.d1({ id: "c6c2834b-6af0-4a1b-9799-9dd0a58b13d5", name: "lucidhire-db" }),
		},
		domains: ["api.lucidhire.io"],
		workersDev: false,
		previewUrls: false,
	},
});
