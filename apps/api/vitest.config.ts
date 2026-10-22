import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Miniflare is slow when several test runs share a machine.
		testTimeout: 20_000,
		hookTimeout: 60_000,
		setupFiles: ["./src/test/setup.ts"],
	},
});
