import {
	EVIDENCE_LEVELS,
	type EvidenceMap,
	type RubricItem,
	WEIGHTS,
	scoreEvidence,
	toChecks,
} from "@lucid-hire/scoring";
import { desc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GEMINI_TEXT_MODEL } from "./ai.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import {
	type DraftRubricParams,
	draftInstanceId,
	mergeRubric,
	recalculateScores,
	runDraftRubric,
	scoreSql,
	startDraft,
} from "./rubric.ts";
import type { DraftedRequirement, RubricDrafter } from "./rubric-drafter.ts";
import { createTestD1 } from "./test/d1.ts";
import { fakeStep } from "./test/steps.ts";

let db: Db;
let dispose: () => Promise<void>;
let orgId: string;

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	db = getDb(testD1.d1);
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
});

afterAll(() => dispose());

const item = (id: string, label: string, weight: RubricItem["weight"] = "must", extra: Partial<RubricItem> = {}): RubricItem => ({
	id,
	label,
	detail: `Needs ${label}`,
	weight,
	...extra,
});

async function seedJob(values: Partial<typeof jobs.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	await db.insert(jobs).values({ id, orgId, title: "iOS Engineer", description: "Swift, SwiftUI", createdBy: "user_admin", ...values });
	return id;
}

async function seedCandidate(jobId: string, values: Partial<typeof candidates.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	await db.insert(candidates).values({
		id,
		orgId,
		jobId,
		fileKey: `${orgId}/${jobId}/${id}.pdf`,
		fileName: "cv.pdf",
		fileSize: 100,
		createdBy: "user_admin",
		...values,
	});
	return id;
}

const jobOf = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const candidateOf = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];
const usageMark = async () => (await db.select().from(aiUsage).orderBy(desc(aiUsage.id)).limit(1))[0]?.id ?? 0;
const usageSince = (mark: number) => db.select().from(aiUsage).where(gt(aiUsage.id, mark));

// A small seeded generator, so a failing case can be found again.
function random(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Case = { rubric: RubricItem[]; evidence: EvidenceMap };

// Random lists of 0 to 15 requirements (some removed, any weight) and evidence for a random part of them, plus ids
// that are on no list, so every branch of the formula comes up.
function generateCases(count: number, seed: number): Case[] {
	const next = random(seed);
	const pick = <T,>(values: readonly T[]) => values[Math.floor(next() * values.length)];
	return Array.from({ length: count }, () => {
		const size = Math.floor(next() * 16);
		const rubric = Array.from({ length: size }, (_, i) =>
			item(`r${i + 1}`, `Skill ${i}`, pick(WEIGHTS), next() < 0.15 ? { removed: true } : {}),
		);
		const evidence: EvidenceMap = {};
		for (const { id } of rubric) {
			if (next() < 0.75) {
				const level = pick(EVIDENCE_LEVELS);
				evidence[id] = { level, quote: level === "none" ? "" : `Quote for ${id}` };
			}
		}
		if (next() < 0.3) evidence.r99 = { level: "clear", quote: "Not on the list" };
		return { rubric, evidence };
	});
}

// Lists whose scores land exactly on a half, which must round up as Math.round does.
const HALVES: Case[] = [
	// 1.5 of 4: 37.5
	{ rubric: [item("r1", "a"), item("r2", "b", "nice")], evidence: { r1: { level: "partial", quote: "q" } } },
	// 5 of 8: 62.5
	{
		rubric: [item("r1", "a"), item("r2", "b"), item("r3", "c", "nice"), item("r4", "d", "nice")],
		evidence: { r1: { level: "clear", quote: "q" }, r2: { level: "partial", quote: "q" }, r3: { level: "partial", quote: "q" } },
	},
	// 0.5 of 8: 6.25, and 0.5 of 2: 25
	{ rubric: Array.from({ length: 8 }, (_, i) => item(`r${i + 1}`, `n${i}`, "nice")), evidence: { r3: { level: "partial", quote: "q" } } },
	{ rubric: [item("r1", "a", "nice"), item("r2", "b", "nice")], evidence: { r2: { level: "partial", quote: "q" } } },
	// 4.5 of 9 and 4.5 of 7 (64.29)
	{ rubric: [item("r1", "a"), item("r2", "b"), item("r3", "c")], evidence: { r1: { level: "clear", quote: "q" }, r2: { level: "partial", quote: "q" } } },
	{ rubric: [item("r1", "a"), item("r2", "b"), item("r3", "c", "nice")], evidence: { r1: { level: "clear", quote: "q" }, r2: { level: "partial", quote: "q" } } },
];

// Nothing counts: no requirements, all removed, all Off. The score is null.
const NOTHING_COUNTS: Case[] = [
	{ rubric: [], evidence: {} },
	{ rubric: [item("r1", "a", "must", { removed: true })], evidence: { r1: { level: "clear", quote: "q" } } },
	{ rubric: [item("r1", "a", "off"), item("r2", "b", "off")], evidence: { r1: { level: "clear", quote: "q" } } },
];

// Runs scoreSql over many cases in one statement each 200, the way the API runs it over a job's CVs.
async function scoreInSql(cases: Case[]): Promise<(number | null)[]> {
	const scores: (number | null)[] = [];
	for (let at = 0; at < cases.length; at += 200) {
		const chunk = cases.slice(at, at + 200);
		const rows = await db.all<{ i: number; score: number | null }>(sql`SELECT c.key AS i,
			${scoreSql(sql`json_extract(c.value, '$.rubric')`, sql`json_extract(c.value, '$.evidence')`)} AS score
			FROM json_each(${JSON.stringify(chunk)}) c ORDER BY c.key`);
		scores.push(...rows.map((row) => row.score));
	}
	return scores;
}

describe("scoreSql", () => {
	it("scores exactly as scoreEvidence does, over a thousand generated lists and evidence", async () => {
		const cases = [...HALVES, ...NOTHING_COUNTS, ...generateCases(1000, 20261024)];
		const expected = cases.map(({ rubric, evidence }) => scoreEvidence(rubric, evidence));
		expect(await scoreInSql(cases)).toEqual(expected);
		// The generated cases cover null scores and scores from 0 to 100.
		expect(expected.filter((score) => score === null).length).toBeGreaterThan(10);
		expect(expected).toContain(0);
		expect(expected).toContain(100);
	});

	it("rounds halves up and gives null when nothing counts", async () => {
		expect(await scoreInSql(HALVES)).toEqual([38, 63, 6, 25, 50, 64]);
		expect(await scoreInSql(NOTHING_COUNTS)).toEqual([null, null, null]);
	});
});

describe("recalculateScores", () => {
	it("re-scores every scored CV of the job in one statement, as scoreEvidence would", async () => {
		const cases = generateCases(60, 7).filter(({ rubric }) => rubric.length > 0);
		const rubric = cases[0].rubric;
		const jobId = await seedJob({ rubric, rubricStatus: "ready" });
		const ids = await Promise.all(cases.map(({ evidence }) => seedCandidate(jobId, { status: "scored", score: -1, evidence })));

		await recalculateScores(db, jobId);
		for (const [i, id] of ids.entries()) {
			expect((await candidateOf(id)).score).toBe(scoreEvidence(rubric, cases[i].evidence));
		}
	});

	it("leaves CVs scored before requirements, CVs not scored, other jobs and updated_at alone", async () => {
		const rubric = [item("r1", "Swift")];
		const jobId = await seedJob({ rubric, rubricStatus: "ready" });
		const otherJob = await seedJob({ rubric, rubricStatus: "ready" });
		const updatedAt = new Date(Date.now() - 3_600_000);
		const clear = { r1: { level: "clear" as const, quote: "q" } };
		const legacy = await seedCandidate(jobId, { status: "scored", score: 71, evidence: null });
		const reading = await seedCandidate(jobId, { status: "scoring", score: 5, evidence: clear });
		const other = await seedCandidate(otherJob, { status: "scored", score: 5, evidence: clear });
		const scored = await seedCandidate(jobId, { status: "scored", score: 5, evidence: clear, updatedAt });

		await recalculateScores(db, jobId);
		expect((await candidateOf(legacy)).score).toBe(71);
		expect((await candidateOf(reading)).score).toBe(5);
		expect((await candidateOf(other)).score).toBe(5);
		expect(await candidateOf(scored)).toMatchObject({ score: 100, updatedAt });
	});
});

describe("mergeRubric", () => {
	const drafted = (label: string, detail = `Needs ${label}`, weight: "must" | "nice" = "must"): DraftedRequirement => ({
		label,
		detail,
		weight,
	});

	it("numbers a first draft from r1", () => {
		expect(mergeRubric(null, [drafted("Swift"), drafted("Figma", "Figma", "nice")])).toEqual([
			{ id: "r1", label: "Swift", detail: "Needs Swift", weight: "must" },
			{ id: "r2", label: "Figma", detail: "Figma", weight: "nice" },
		]);
	});

	it("keeps the id, wording, label and weight of a requirement the redraft keeps, case and spacing aside", () => {
		const current = [
			item("r1", "Swift", "must"),
			{ ...item("r2", "A11y", "off"), detail: "VoiceOver support" },
			item("r3", "Kotlin", "nice"),
		];
		const next = mergeRubric(current, [drafted("SwiftUI"), drafted("VoiceOver", "voiceover  SUPPORT", "must"), drafted("Swift", "needs swift")]);
		expect(next).toEqual([
			{ id: "r4", label: "SwiftUI", detail: "Needs SwiftUI", weight: "must" },
			{ id: "r2", label: "A11y", detail: "VoiceOver support", weight: "off" },
			{ id: "r1", label: "Swift", detail: "Needs Swift", weight: "must" },
			{ ...item("r3", "Kotlin", "nice"), removed: true },
		]);
	});

	it("never reuses an id, removed ones included, and brings back a removed requirement the draft asks for again", () => {
		const current = [item("r1", "Swift"), item("r7", "Figma", "nice", { removed: true }), item("r3", "Kotlin", "nice", { removed: true })];
		const next = mergeRubric(current, [drafted("Kotlin"), drafted("Combine")]);
		expect(next).toEqual([
			{ id: "r3", label: "Kotlin", detail: "Needs Kotlin", weight: "nice" },
			{ id: "r8", label: "Combine", detail: "Needs Combine", weight: "must" },
			{ ...item("r1", "Swift"), removed: true },
			item("r7", "Figma", "nice", { removed: true }),
		]);
	});

	it("matches a requirement on the job before a removed one with the same detail, and each only once", () => {
		const current = [item("r1", "Swift old", "nice", { removed: true }), { ...item("r2", "Swift"), detail: "Needs Swift" }];
		const next = mergeRubric(current, [drafted("Swift"), drafted("Swift twice", "NEEDS SWIFT")]);
		expect(next.map(({ id, removed }) => [id, removed ?? false])).toEqual([
			["r2", false],
			["r3", false],
			["r1", true],
		]);
	});
});

describe("startDraft", () => {
	let created: { id: string; params: DraftRubricParams }[];
	let failWith: Error | null;
	const starter = {
		create: async (options: { id: string; params: DraftRubricParams }) => {
			if (failWith) throw failWith;
			created.push(options);
			return { id: options.id } as WorkflowInstance;
		},
	} as unknown as Parameters<typeof startDraft>[0];

	beforeEach(() => {
		created = [];
		failWith = null;
	});

	it("starts one instance named after the job and the version", async () => {
		const params = { jobId: "job-1", version: 3, userId: "user_admin" };
		expect(await startDraft(starter, db, params, { claimed: true })).toBe(true);
		expect(created).toEqual([{ id: "rubric-job-1-v3", params }]);
		expect(draftInstanceId(params)).toBe("rubric-job-1-v3");
	});

	it("treats an instance that already exists as started", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 2 });
		failWith = new Error('Workflow instance with id "x" already exists');
		expect(await startDraft(starter, db, { jobId, version: 2, userId: null }, { claimed: true })).toBe(true);
		expect((await jobOf(jobId)).rubricStatus).toBe("drafting");
	});

	it("fails the draft its caller claimed when the Workflow won't start, and only that one", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 2 });
		failWith = new Error("Workflows is down");
		expect(await startDraft(starter, db, { jobId, version: 1, userId: null }, { claimed: true })).toBe(false);
		expect((await jobOf(jobId)).rubricStatus).toBe("drafting");
		expect(await startDraft(starter, db, { jobId, version: 2, userId: null }, { claimed: false })).toBe(false);
		expect((await jobOf(jobId)).rubricStatus).toBe("drafting");
		expect(await startDraft(starter, db, { jobId, version: 2, userId: null }, { claimed: true })).toBe(false);
		expect((await jobOf(jobId)).rubricStatus).toBe("failed");
	});
});

describe("runDraftRubric", () => {
	let drafterCalls: Parameters<RubricDrafter>[0][];
	let answer: DraftedRequirement[];
	let drafterError: Error | null;
	const drafter: RubricDrafter = async (input) => {
		drafterCalls.push(input);
		if (drafterError) throw drafterError;
		return { value: answer, inputTokens: 700, outputTokens: 150 };
	};

	beforeEach(() => {
		drafterCalls = [];
		drafterError = null;
		answer = [
			{ label: "Swift", detail: "5+ years of Swift", weight: "must" },
			{ label: "Figma", detail: "Figma is a plus", weight: "nice" },
		];
	});

	it("drafts a job's first list, makes it ready and books the call", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 1 });
		const mark = await usageMark();
		const { step, names } = fakeStep();
		await runDraftRubric(step, { db, drafter }, { jobId, version: 1, userId: "user_admin" });

		expect(names).toEqual(["draft", "save"]);
		expect(drafterCalls).toEqual([{ jobTitle: "iOS Engineer", jobDescription: "Swift, SwiftUI" }]);
		expect(await jobOf(jobId)).toMatchObject({
			rubricStatus: "ready",
			rubricVersion: 1,
			rubric: [
				{ id: "r1", label: "Swift", detail: "5+ years of Swift", weight: "must" },
				{ id: "r2", label: "Figma", detail: "Figma is a plus", weight: "nice" },
			],
		});
		expect(await usageSince(mark)).toMatchObject([
			{ orgId, jobId, userId: "user_admin", operation: "rubric_draft", model: GEMINI_TEXT_MODEL, ok: true, inputTokens: 700, outputTokens: 150 },
		]);
	});

	it("keeps the ids, and so the evidence, of requirements a redraft keeps, and re-scores the job's CVs", async () => {
		const current = [
			{ id: "r1", label: "Swift", detail: "5+ years of Swift", weight: "must" as const },
			{ id: "r2", label: "Kotlin", detail: "Kotlin", weight: "nice" as const },
		];
		const jobId = await seedJob({ rubric: current, rubricStatus: "drafting", rubricVersion: 4 });
		const evidence: EvidenceMap = { r1: { level: "clear", quote: "Six years of Swift" }, r2: { level: "clear", quote: "Kotlin" } };
		const cv = await seedCandidate(jobId, { status: "scored", score: 100, evidence });
		const legacy = await seedCandidate(jobId, { status: "scored", score: 55, evidence: null });
		answer = [
			{ label: "Swift dev", detail: "5+ YEARS of  Swift", weight: "nice" },
			{ label: "SwiftUI", detail: "SwiftUI", weight: "must" },
		];
		await runDraftRubric(fakeStep().step, { db, drafter }, { jobId, version: 4, userId: null });

		// The model saw the current list, so it could keep its wording.
		expect(drafterCalls[0].current).toEqual(current);
		const { rubric } = await jobOf(jobId);
		expect(rubric).toEqual([
			current[0],
			{ id: "r3", label: "SwiftUI", detail: "SwiftUI", weight: "must" },
			{ ...current[1], removed: true },
		]);
		// Swift is still clear; SwiftUI isn't checked yet: 3 of 6.
		expect(await candidateOf(cv)).toMatchObject({ evidence, score: 50 });
		expect(toChecks(rubric ?? [], evidence).map(({ id, level }) => [id, level])).toEqual([
			["r1", "clear"],
			["r3", null],
		]);
		expect((await candidateOf(legacy)).score).toBe(55);
	});

	it("fails the draft after the step's retries, booking every call, and leaves the list as it was", async () => {
		const current = [item("r1", "Swift")];
		const jobId = await seedJob({ rubric: current, rubricStatus: "drafting", rubricVersion: 2 });
		drafterError = new Error("The model is overloaded");
		const mark = await usageMark();
		const { step, names } = fakeStep();
		await expect(runDraftRubric(step, { db, drafter }, { jobId, version: 2, userId: "user_admin" })).rejects.toBe(drafterError);

		expect(names).toEqual(["draft", "draft", "draft", "draft", "fail"]);
		expect(await jobOf(jobId)).toMatchObject({ rubricStatus: "failed", rubric: current });
		expect(await usageSince(mark)).toMatchObject(Array.from({ length: 4 }, () => ({ operation: "rubric_draft", ok: false })));
	});

	it("stops quietly, without calling Gemini, when a newer draft took over or the job is gone", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 3 });
		const { step, names } = fakeStep();
		await runDraftRubric(step, { db, drafter }, { jobId, version: 2, userId: null });
		await runDraftRubric(step, { db, drafter }, { jobId: "deleted", version: 1, userId: null });
		expect(names).toEqual(["draft", "draft"]);
		expect(drafterCalls).toEqual([]);
		expect((await jobOf(jobId)).rubricStatus).toBe("drafting");
	});

	it("drops a draft that was overtaken while Gemini was writing it, but books the call", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 1 });
		const mark = await usageMark();
		const overtaking: RubricDrafter = async (input) => {
			// Someone asks for a fresh draft meanwhile.
			await db.update(jobs).set({ rubricVersion: 2 }).where(eq(jobs.id, jobId));
			return drafter(input);
		};
		await runDraftRubric(fakeStep().step, { db, drafter: overtaking }, { jobId, version: 1, userId: null });
		expect(await jobOf(jobId)).toMatchObject({ rubricStatus: "drafting", rubric: null });
		expect(await usageSince(mark)).toMatchObject([{ ok: true }]);
	});

	it("doesn't book a draft twice when the save step runs again", async () => {
		const jobId = await seedJob({ rubricStatus: "drafting", rubricVersion: 1 });
		const mark = await usageMark();
		let saves = 0;
		const { step } = fakeStep();
		// The engine lost the answer of the first save, so it runs the step again.
		const flaky = {
			do: async (name: string, ...rest: unknown[]) => {
				const result = await (step.do as (...args: unknown[]) => Promise<unknown>)(name, ...rest);
				if (name === "save" && ++saves === 1) await (step.do as (...args: unknown[]) => Promise<unknown>)(name, ...rest);
				return result;
			},
		} as unknown as typeof step;
		await runDraftRubric(flaky, { db, drafter }, { jobId, version: 1, userId: null });
		expect(await usageSince(mark)).toHaveLength(1);
		expect((await jobOf(jobId)).rubricStatus).toBe("ready");
	});
});
