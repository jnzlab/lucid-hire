import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		// Code-split pages load on first use, which is slow when several test runs share a machine.
		testTimeout: 20_000,
	},
});
