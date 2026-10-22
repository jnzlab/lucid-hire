import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Every test file starts its own Miniflare D1, which is slow when files run side by side.
		testTimeout: 30_000,
		hookTimeout: 60_000,
		setupFiles: ["./src/test/setup.ts"],
	},
});
