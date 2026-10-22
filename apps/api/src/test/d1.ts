/// <reference types="vite/client" />
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
});

// A fresh in-memory D1 database (the real engine, through Miniflare) with every migration applied,
// plus an empty R2 bucket for the CV files.
export async function createTestD1() {
	const mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: "export default {}",
			d1Databases: ["DB"],
			r2Buckets: ["CVS"],
		}),
	);
	const d1 = await mf.getD1Database("DB");
	const cvs = await mf.getR2Bucket("CVS");

	for (const path of Object.keys(migrations).sort()) {
		for (const statement of migrations[path].split("--> statement-breakpoint")) {
			if (statement.trim()) await d1.prepare(statement).run();
		}
	}

	return { d1: d1 as unknown as D1Database, cvs: cvs as unknown as R2Bucket, dispose: () => mf.dispose() };
}
