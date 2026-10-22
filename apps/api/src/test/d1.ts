/// <reference types="vite/client" />
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
});

// A fresh in-memory D1 database (the real engine, through Miniflare) with every migration applied.
export async function createTestD1() {
	const mf = new Miniflare(
		convertV4MiniflareOptions({ modules: true, script: "export default {}", d1Databases: ["DB"] }),
	);
	const d1 = await mf.getD1Database("DB");

	for (const path of Object.keys(migrations).sort()) {
		for (const statement of migrations[path].split("--> statement-breakpoint")) {
			if (statement.trim()) await d1.prepare(statement).run();
		}
	}

	return { d1: d1 as unknown as D1Database, dispose: () => mf.dispose() };
}
