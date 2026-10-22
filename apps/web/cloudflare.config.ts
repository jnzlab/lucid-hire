import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// The frontend Worker: the SPA's static assets on lucidhire.io. www.lucidhire.io is attached too,
// and every request runs the Worker first so it can redirect www to the apex before serving assets.
export default defineConfig({
	worker: {
		name: "lucidhire-app",
		compatibilityDate: "2026-10-19",
		entrypoint,
		observability: { enabled: true },
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: true,
		},
		env: {
			ASSETS: bindings.assets(),
		},
		domains: ["lucidhire.io", "www.lucidhire.io"],
		workersDev: false,
		previewUrls: false,
	},
});
