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
		},
		domains: ["api.lucidhire.io"],
		workersDev: false,
		previewUrls: false,
	},
});
