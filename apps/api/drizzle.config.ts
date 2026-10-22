import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from the schema. `cf d1 migrations apply` runs them, locally and on deploy.
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./migrations",
});
