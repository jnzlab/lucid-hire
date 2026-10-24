// How steady and how right is the CV scorer? Scores each sample CV several times against the sample job's list of
// requirements with the production code, and reports the spread, the rank order, which levels moved between identical
// runs, how many levels match the answer key, and whether every quote really is in the CV and shows work rather than a
// goal. It also drafts the job's
// list a few times and reports how much the drafts agree.
//
// The CVs are scored against a fixed list (the job's own lines, as the landing demo shows them) rather than a fresh
// draft, so a run measures the scorer alone and has an answer key: the levels the CVs were written to earn.
//
// Spends real Gemini calls on the key in apps/api/.dev.vars (DRAFTS + 4 × RUNS, about 23 by default; the free tier
// allows 500 a day), so it isn't part of `check`. Run: pnpm --filter @lucid-hire/api bench:scoring
// Only the fictional CVs in fixtures/cvs go through it.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvidenceLevel, type EvidenceMap, type RubricItem, scoreEvidence } from "@lucid-hire/scoring";
import { scoreCvWithGemini } from "../src/cv-scorer.ts";
import { draftRubricWithGemini } from "../src/rubric-drafter.ts";

const RUNS = Number(process.env.RUNS ?? 5);
const DRAFTS = Number(process.env.DRAFTS ?? 3);
// The free tier takes 15 requests a minute, and a call takes 10 to 25 seconds.
const CONCURRENCY = 2;
// What a steady scorer has to hit (the plan's success criteria).
const MAX_SPREAD = 10;

const root = new URL("../../../", import.meta.url).pathname;
const fixtures = join(root, "fixtures/cvs");
// The order the sample CVs are written to land in (fixtures/cvs/README.md).
const CVS = ["grace-turner", "kenji-tanaka", "lucas-becker", "amelia-nguyen"];

// The job's requirements in its own words, labelled as the landing demo labels them.
const RUBRIC: RubricItem[] = [
	{ id: "r1", label: "Swift", detail: "Several years of Swift in production apps", weight: "must" },
	{ id: "r2", label: "SwiftUI", detail: "SwiftUI shipped in a live app", weight: "must" },
	{ id: "r3", label: "Performance", detail: "Performance work, with profiling in Instruments", weight: "must" },
	{ id: "r4", label: "Accessibility", detail: "Accessibility experience, including VoiceOver and Dynamic Type", weight: "must" },
	{ id: "r5", label: "GraphQL", detail: "GraphQL on the client side, with any library", weight: "nice" },
	{ id: "r6", label: "Kotlin Multiplatform", detail: "Kotlin Multiplatform, with code shared between iOS and Android", weight: "nice" },
];
// What each CV was written to show for r1 to r6 (the landing demo's evidence for the same people): 93, 71, 54, 50.
const ANSWER_KEY: Record<string, EvidenceLevel[]> = {
	"grace-turner": ["clear", "clear", "clear", "clear", "clear", "none"],
	"kenji-tanaka": ["clear", "clear", "partial", "partial", "clear", "none"],
	"lucas-becker": ["clear", "partial", "partial", "partial", "none", "none"],
	"amelia-nguyen": ["partial", "partial", "none", "clear", "clear", "none"],
};

// The sentences in the sample CVs that only state a goal. A level is earned by work, so none of them is ever a quote.
const GOALS: Record<string, string[]> = {
	"kenji-tanaka": ["Looking to go deeper on performance tuning and accessibility in a senior role."],
	"lucas-becker": ["keen to grow into a senior role."],
};

const vars = readFileSync(join(root, "apps/api/.dev.vars"), "utf8");
const apiKey = vars.match(/^GOOGLE_GENERATIVE_AI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing from apps/api/.dev.vars");

const [jobTitle, ...rest] = readFileSync(join(fixtures, "senior-ios-engineer.txt"), "utf8").split("\n");
const jobDescription = rest.join("\n").trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

// Gemini on the free tier answers 503 and 429 often; back off like the Workflow step does.
async function withRetries<T>(label: string, call: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (attempt >= 4) throw new Error(`${label}: ${message}`);
			console.log(`  ${label}: try ${attempt} failed (${message.slice(0, 100)}), retrying`);
			await sleep(15_000 * 2 ** (attempt - 1));
		}
	}
}

// Text comparison that ignores case, curly quotes, dash styles, bullets and spacing.
const norm = (s: string) =>
	s
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[‘’‚′]/g, "'")
		.replace(/[“”„″]/g, '"')
		.replace(/[‐-―−]/g, "-")
		.replace(/[·•●▪]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const cvText = (name: string) =>
	norm(
		readFileSync(join(fixtures, `${name}.html`), "utf8")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;|&apos;/g, "'")
			.replace(/&middot;/g, " ")
			.replace(/&[nm]dash;/g, "-")
			.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))),
	);

// 1. The requirement list, drafted a few times from the same description.
console.log(`Drafting the requirement list for "${jobTitle}" ${DRAFTS} times`);
const drafts: { label: string; detail: string; weight: "must" | "nice" }[][] = [];
for (let i = 0; i < DRAFTS; i++) {
	const { value } = await withRetries(`draft ${i + 1}`, () => draftRubricWithGemini(apiKey, { jobTitle, jobDescription }));
	drafts.push(value);
	console.log(`  draft ${i + 1}: ${value.map((r) => `${r.label} (${r.weight})`).join(", ")}`);
}
const details = drafts.map((d) => new Set(d.map((r) => norm(r.detail))));
const shared = [...details[0]].filter((detail) => details.every((set) => set.has(detail))).length;
console.log(`  items per draft [${drafts.map((d) => d.length).join(", ")}], ${shared} of draft 1's ${details[0].size} in every draft\n`);

// 2. Every CV against the fixed list, several times.
const rubric = RUBRIC;
type Run = { name: string; run: number; ms: number; evidence: EvidenceMap; score: number | null };
const runs: Run[] = [];
const tasks = Array.from({ length: RUNS }, (_, run) => CVS.map((name) => ({ name, run }))).flat();
let next = 0;
console.log(`Scoring ${CVS.length} CVs × ${RUNS} runs against the job's own list`);
await Promise.all(
	Array.from({ length: CONCURRENCY }, async () => {
		while (next < tasks.length) {
			const { name, run } = tasks[next++];
			const pdf = new Uint8Array(readFileSync(join(fixtures, `${name}.pdf`)));
			const started = Date.now();
			const { value } = await withRetries(`${name} run ${run + 1}`, () =>
				scoreCvWithGemini(apiKey, { jobTitle, jobDescription, rubric, pdf }),
			);
			const score = scoreEvidence(rubric, value.evidence);
			runs.push({ name, run, ms: Date.now() - started, evidence: value.evidence, score });
			console.log(`  ${name} run ${run + 1}: ${score}`);
		}
	}),
);

// 3. The report.
const out = process.env.OUT ?? join(tmpdir(), `lucidhire-bench-${Date.now()}.json`);
writeFileSync(out, JSON.stringify({ jobTitle, drafts, rubric, runs }, null, 2));

console.log("\nScore spread (same CV, same list, same code)");
let worstSpread = 0;
for (const name of CVS) {
	const scores = runs.filter((r) => r.name === name).sort((a, b) => a.run - b.run).map((r) => r.score ?? 0);
	const spread = Math.max(...scores) - Math.min(...scores);
	worstSpread = Math.max(worstSpread, spread);
	console.log(`  ${name.padEnd(14)} [${scores.join(", ")}]  mean ${mean(scores).toFixed(1)}  sd ${sd(scores).toFixed(1)}  spread ${spread}`);
}

console.log("\nRank order per run (written to be grace > kenji > lucas > amelia)");
let exact = 0;
for (let run = 0; run < RUNS; run++) {
	const row = CVS.map((name) => runs.find((r) => r.name === name && r.run === run)!);
	const order = [...row].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
	const tie = new Set(row.map((r) => r.score)).size < row.length;
	if (!tie && order.every((r, i) => r.name === CVS[i])) exact++;
	console.log(`  run ${run + 1}: ${order.map((r) => `${r.name.split("-")[0]} ${r.score}`).join(" > ")}${tie ? "  (tie)" : ""}`);
}

console.log("\nLevels that moved between identical runs");
let moved = 0;
for (const name of CVS) {
	for (const item of rubric) {
		const levels = runs.filter((r) => r.name === name).map((r) => r.evidence[item.id]?.level ?? "none");
		if (new Set(levels).size > 1) {
			moved++;
			console.log(`  ${name} / ${item.label} (${item.weight}): ${levels.join(", ")}`);
		}
	}
}
if (!moved) console.log("  none");

console.log("\nLevels vs the answer key");
let right = 0;
const wrong: string[] = [];
for (const r of runs) {
	rubric.forEach((item, k) => {
		const level = r.evidence[item.id]?.level ?? "none";
		if (level === ANSWER_KEY[r.name][k]) right++;
		else wrong.push(`  ${r.name} run ${r.run + 1} / ${item.label}: ${level}, key says ${ANSWER_KEY[r.name][k]}`);
	});
}
console.log(`  ${right} of ${runs.length * rubric.length} match`);
for (const miss of wrong) console.log(miss);

console.log("\nQuotes vs the CV's text");
let quotes = 0;
const misses: string[] = [];
for (const r of runs) {
	const text = cvText(r.name);
	for (const [id, { level, quote }] of Object.entries(r.evidence)) {
		if (level === "none") continue;
		quotes++;
		const q = norm(quote).replace(/^["']|["'.,;:]$/g, "").trim();
		if (!text.includes(q)) misses.push(`  ${r.name} run ${r.run + 1} ${id}: "${quote}"`);
	}
}
console.log(`  ${quotes - misses.length} of ${quotes} found word for word`);
for (const miss of misses) console.log(miss);

console.log("\nQuotes that are a goal rather than work");
const goalQuotes: string[] = [];
for (const r of runs) {
	const goals = (GOALS[r.name] ?? []).map((goal) => norm(goal).replace(/\.$/, ""));
	for (const [id, { level, quote }] of Object.entries(r.evidence)) {
		if (level === "none") continue;
		const q = norm(quote).replace(/^["']|["'.,;:]$/g, "").trim();
		if (goals.some((goal) => goal.includes(q) || q.includes(goal))) goalQuotes.push(`  ${r.name} run ${r.run + 1} ${id} (${level}): "${quote}"`);
	}
}
console.log(goalQuotes.length ? goalQuotes.join("\n") : "  none");

const ms = runs.map((r) => r.ms);
console.log(`\nLatency: mean ${(mean(ms) / 1000).toFixed(1)} s, max ${(Math.max(...ms) / 1000).toFixed(1)} s`);
console.log("\nTargets");
console.log(`  ${exact === RUNS ? "PASS" : "FAIL"}  written order in every run (${exact}/${RUNS})`);
console.log(`  ${worstSpread <= MAX_SPREAD ? "PASS" : "FAIL"}  no CV moves more than ${MAX_SPREAD} points (worst ${worstSpread})`);
console.log(`  ${misses.length === 0 ? "PASS" : "FAIL"}  every quote is in the CV (${quotes - misses.length}/${quotes})`);
console.log(`  ${wrong.length === 0 ? "PASS" : "FAIL"}  every level matches the answer key (${right}/${right + wrong.length})`);
console.log(`  ${goalQuotes.length === 0 ? "PASS" : "FAIL"}  every quote shows work, not a goal (${quotes - goalQuotes.length}/${quotes})`);
console.log(`\nRaw results: ${out}`);
