import {
	DETAIL_MAX,
	LABEL_MAX,
	LEVEL_VALUE,
	RUBRIC_MAX_ITEMS,
	type RubricItem,
	WEIGHTS,
	WEIGHT_VALUE,
	nextRequirementId,
	visibleItems,
} from "@lucid-hire/scoring";
import { type SQL, and, eq, isNotNull, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { WorkflowStep } from "cloudflare:workers";
import { z } from "zod";
import { GEMINI_STEP, recordAiUsage } from "./ai.ts";
import type { Db } from "./db/client.ts";
import { candidates, jobs } from "./db/schema.ts";
import { type Job, inOrg, jobColumns } from "./jobs.ts";
import { type DraftedRequirement, type RubricDrafter, detailKey } from "./rubric-drafter.ts";

// A job's list of requirements: the SQL that scores CVs against it, drafting it with Gemini (DraftRubricWorkflow),
// and a recruiter's edits. The formula itself is @lucid-hire/scoring's; the SQL here mirrors it exactly, and a test
// holds the two to each other.

export const RUBRIC_DRAFT_OPERATION = "rubric_draft";

type SqlJson = SQL | SQLiteColumn;
const literal = (value: number) => sql.raw(String(value));

// The job's requirements still on it, in the job's order, each with the CV's evidence: level and quote are null while
// the CV hasn't been checked against it. `rubric` and `evidence` are the two JSON texts. A Max job holds 1,000 CVs, so
// lists, scores and the export are all built from these rows inside SQLite rather than on the Worker.
export const requirementRows = (rubric: SqlJson, evidence: SqlJson) => sql`SELECT r.key AS k,
	json_extract(r.value, '$.id') AS id, json_extract(r.value, '$.label') AS label,
	json_extract(r.value, '$.detail') AS detail, json_extract(r.value, '$.weight') AS weight,
	json_extract(e.value, '$.level') AS level, json_extract(e.value, '$.quote') AS quote
	FROM json_each(${rubric}) r LEFT JOIN json_each(${evidence}) e ON e.key = json_extract(r.value, '$.id')
	WHERE NOT coalesce(json_extract(r.value, '$.removed'), 0)`;

const weightValue = sql`CASE q.weight WHEN 'must' THEN ${literal(WEIGHT_VALUE.must)}
	WHEN 'nice' THEN ${literal(WEIGHT_VALUE.nice)} ELSE ${literal(WEIGHT_VALUE.off)} END`;
const levelValue = sql`CASE q.level WHEN 'clear' THEN ${literal(LEVEL_VALUE.clear)}
	WHEN 'partial' THEN ${literal(LEVEL_VALUE.partial)} ELSE ${literal(LEVEL_VALUE.none)} END`;

// scoreEvidence() in SQL: round(100 × Σ weight·value / Σ weight), null when nothing counts. SQLite's round() takes
// halves away from zero, which for a score (never negative) is Math.round's half up.
export const scoreSql = (rubric: SqlJson, evidence: SqlJson) => sql`(SELECT CASE WHEN coalesce(sum(w), 0) = 0 THEN NULL
	ELSE CAST(round(100.0 * sum(w * v) / sum(w)) AS INTEGER) END
	FROM (SELECT ${weightValue} AS w, ${levelValue} AS v FROM (${requirementRows(rubric, evidence)}) q))`;

// The current requirements of the candidate's own job, for a statement on the candidates table.
export const rubricOfCandidate = sql`(SELECT ${jobs.rubric} FROM ${jobs} WHERE ${jobs.id} = ${candidates.jobId})`;

// Re-scores every scored CV of the job from its current requirements, in ONE statement: the Worker never loops over
// the rows. A CV scored before jobs had requirements has no evidence and keeps its old score. `updated_at` is left
// alone: it times reading runs.
export const recalculateScores = (db: Db, jobId: string) =>
	db
		.update(candidates)
		.set({
			score: scoreSql(sql`(SELECT ${jobs.rubric} FROM ${jobs} WHERE ${jobs.id} = ${jobId})`, candidates.evidence),
			updatedAt: sql`${candidates.updatedAt}`,
		})
		.where(and(eq(candidates.jobId, jobId), eq(candidates.status, "scored"), isNotNull(candidates.evidence)));

// A new draft laid over the job's current list. A drafted requirement whose detail matches an existing one (case and
// spacing aside) keeps that one's id, so CVs keep their evidence for it, along with the recruiter's label and weight;
// a removed one comes back. Current requirements the draft dropped are marked removed, and new ones get new ids.
export function mergeRubric(current: readonly RubricItem[] | null, drafted: readonly DraftedRequirement[]): RubricItem[] {
	const existing = current ?? [];
	const byDetail = new Map<string, RubricItem>();
	// Requirements still on the job win over removed ones with the same detail.
	for (const item of [...visibleItems(existing), ...existing.filter((item) => item.removed)]) {
		if (!byDetail.has(detailKey(item.detail))) byDetail.set(detailKey(item.detail), item);
	}
	const kept = new Set<string>();
	const next: RubricItem[] = [];
	for (const { label, detail, weight } of drafted) {
		const match = byDetail.get(detailKey(detail));
		if (match && !kept.has(match.id)) {
			kept.add(match.id);
			next.push({ id: match.id, label: match.label, detail: match.detail, weight: match.weight });
		} else {
			next.push({ id: nextRequirementId([...existing, ...next]), label, detail, weight });
		}
	}
	const dropped = existing.filter((item) => !kept.has(item.id)).map((item) => ({ ...item, removed: true as const }));
	return [...next, ...dropped];
}

export type DraftRubricParams = { jobId: string; version: number; userId: string | null };
// Starts one DraftRubricWorkflow instance (the DRAFT_RUBRIC binding).
export type DraftStarter = Pick<Workflow<DraftRubricParams>, "create">;

// One instance per version of the list, so starting a draft that is already running is a no-op.
export const draftInstanceId = ({ jobId, version }: Pick<DraftRubricParams, "jobId" | "version">) =>
	`rubric-${jobId}-v${version}`;
const alreadyExists = (error: unknown) => error instanceof Error && /already.?exists/i.test(error.message);

// Ends a draft that failed. Only the draft named by `version` is ended: a newer one may be under way.
export async function markDraftFailed(db: Db, { jobId, version }: Pick<DraftRubricParams, "jobId" | "version">) {
	await db
		.update(jobs)
		.set({ rubricStatus: "failed", updatedAt: sql`${jobs.updatedAt}` })
		.where(and(eq(jobs.id, jobId), eq(jobs.rubricVersion, version), eq(jobs.rubricStatus, "drafting")));
}

// Starts the Workflow for a draft. Whoever claimed the draft passes `claimed`: if the Workflow won't start, the draft is
// failed rather than left drafting forever, so the next trigger tries again. Anyone else is only making sure a draft
// that is under way has its Workflow, and leaves the status alone. True when the Workflow is (now) running.
export async function startDraft(
	starter: DraftStarter,
	db: Db,
	params: DraftRubricParams,
	{ claimed }: { claimed: boolean },
): Promise<boolean> {
	try {
		await starter.create({ id: draftInstanceId(params), params });
		return true;
	} catch (error) {
		if (alreadyExists(error)) return true;
		console.error(`[${params.jobId}] drafting the requirements did not start`, error);
		if (claimed) await markDraftFailed(db, params);
		return false;
	}
}

// What the "draft" step returns to the Workflow: small JSON, well under the 1 MiB step limit.
export type DraftStepOutput = {
	orgId: string;
	items: DraftedRequirement[];
	usage: { inputTokens: number | null; outputTokens: number | null };
};

// The draft named by `version`, while it is still the job's current one.
const isCurrentDraft = ({ jobId, version }: DraftRubricParams) =>
	and(eq(jobs.id, jobId), eq(jobs.rubricVersion, version), eq(jobs.rubricStatus, "drafting"));

// One Gemini call from the job's title and description. The requirements already on the job go with it, so the model
// keeps their wording where they still apply. Null when the job was deleted or a newer draft took over.
export async function draftForJob(db: Db, drafter: RubricDrafter, params: DraftRubricParams): Promise<DraftStepOutput | null> {
	const [job] = await db
		.select({ orgId: jobs.orgId, title: jobs.title, description: jobs.description, rubric: jobs.rubric })
		.from(jobs)
		.where(isCurrentDraft(params))
		.limit(1);
	if (!job) return null;
	try {
		const { value, inputTokens, outputTokens } = await drafter({
			jobTitle: job.title,
			jobDescription: job.description,
			...(job.rubric && { current: visibleItems(job.rubric) }),
		});
		return { orgId: job.orgId, items: value, usage: { inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null } };
	} catch (error) {
		// One usage row per Gemini call, so a failed call is booked here, per attempt.
		await recordAiUsage(db, {
			orgId: job.orgId,
			userId: params.userId,
			jobId: params.jobId,
			operation: RUBRIC_DRAFT_OPERATION,
			ok: false,
		});
		throw error;
	}
}

// Lays the draft over the job's list and makes it ready, and re-scores the job's scored CVs against it, in one batch
// (D1 runs a batch as a transaction). A draft that was overtaken is dropped, but its call is still booked.
export async function saveDraft(db: Db, params: DraftRubricParams, { orgId, items, usage }: DraftStepOutput): Promise<void> {
	const [job] = await db
		.select({ rubric: jobs.rubric, status: jobs.rubricStatus })
		.from(jobs)
		.where(and(eq(jobs.id, params.jobId), eq(jobs.rubricVersion, params.version)))
		.limit(1);
	// Ready at this version means an earlier try of this step saved it and only its answer was lost.
	if (job?.status === "ready") return;
	if (job?.status === "drafting") {
		await db.batch([
			db
				.update(jobs)
				.set({ rubric: mergeRubric(job.rubric, items), rubricStatus: "ready", updatedAt: sql`${jobs.updatedAt}` })
				.where(isCurrentDraft(params)),
			recalculateScores(db, params.jobId),
		]);
	}
	await recordAiUsage(db, {
		orgId,
		userId: params.userId,
		jobId: params.jobId,
		operation: RUBRIC_DRAFT_OPERATION,
		ok: true,
		inputTokens: usage.inputTokens ?? undefined,
		outputTokens: usage.outputTokens ?? undefined,
	});
}

// Drafts one job's list: one Gemini call with the step's retries, then the save. Every failure ends in the "fail"
// step, so a job is never left drafting. DraftRubricWorkflow hands it the real step; tests hand it a fake one.
export async function runDraftRubric(
	step: Pick<WorkflowStep, "do">,
	{ db, drafter }: { db: Db; drafter: RubricDrafter },
	params: DraftRubricParams,
): Promise<void> {
	try {
		const drafted = await step.do("draft", GEMINI_STEP, () => draftForJob(db, drafter, params));
		// The job was deleted, or a newer draft took over.
		if (!drafted) return;
		await step.do("save", async () => {
			await saveDraft(db, params, drafted);
			return true;
		});
	} catch (error) {
		console.error(`[${params.jobId}] drafting the requirements failed`, error);
		await step.do("fail", async () => {
			await markDraftFailed(db, params);
			return true;
		});
		throw error;
	}
}

const LABEL_HINT = `Name the requirement in 1 to ${LABEL_MAX} characters`;
const DETAIL_HINT = `Describe the requirement in 1 to ${DETAIL_MAX} characters`;
const WEIGHT_HINT = "Choose must, nice or off";
const CHANGES_HINT = `Send between 1 and ${RUBRIC_MAX_ITEMS} changes`;

// Trimmed, with inner whitespace collapsed, like job titles.
const label = z
	.string({ error: LABEL_HINT })
	.transform((value) => value.trim().replace(/\s+/g, " "))
	.pipe(z.string().min(1, { error: LABEL_HINT }).max(LABEL_MAX, { error: LABEL_HINT }));
const detail = z
	.string({ error: DETAIL_HINT })
	.transform((value) => value.trim().replace(/\s+/g, " "))
	.pipe(z.string().min(1, { error: DETAIL_HINT }).max(DETAIL_MAX, { error: DETAIL_HINT }));
const weight = z.enum(WEIGHTS, { error: WEIGHT_HINT });

export const rubricChangesInput = z.object({
	changes: z
		.array(
			z
				.object({
					id: z.string({ error: "Send each requirement's id as text" }).min(1).max(20),
					weight: weight.optional(),
					label: label.optional(),
					removed: z.literal(true, { error: "Send removed as true, or leave it out" }).optional(),
				})
				.refine((change) => change.weight !== undefined || change.label !== undefined || change.removed, {
					error: "Say what to change about each requirement",
				}),
			{ error: CHANGES_HINT },
		)
		.min(1, { error: CHANGES_HINT })
		.max(RUBRIC_MAX_ITEMS, { error: CHANGES_HINT })
		.refine((changes) => new Set(changes.map(({ id }) => id)).size === changes.length, {
			error: "List each requirement only once",
		}),
});

export const newRequirementInput = z.object({ label, detail, weight });

export type RubricEditError = "job_not_found" | "rubric_not_ready" | "unknown_requirement" | "rubric_empty" | "rubric_full";
type Edit = (rubric: RubricItem[]) => RubricItem[] | RubricEditError;

// Two recruiters editing at once: the loser of the version check reads the list again and reapplies its edit.
const EDIT_ATTEMPTS = 3;

// Applies one edit to the job's ready list and re-scores the job's scored CVs, in one batch. The write only lands on
// the version that was read, so a concurrent edit or a draft that has just started is never overwritten.
async function editRubric(db: Db, orgId: string, jobId: string, edit: Edit): Promise<Job | RubricEditError> {
	for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
		const [job] = await db
			.select({ rubric: jobs.rubric, status: jobs.rubricStatus, version: jobs.rubricVersion })
			.from(jobs)
			.where(inOrg(orgId, jobId))
			.limit(1);
		if (!job) return "job_not_found";
		if (job.status !== "ready" || !job.rubric) return "rubric_not_ready";
		const rubric = edit(job.rubric);
		if (typeof rubric === "string") return rubric;

		const [[saved]] = await db.batch([
			db
				.update(jobs)
				.set({ rubric, rubricVersion: sql`${jobs.rubricVersion} + 1` })
				.where(and(inOrg(orgId, jobId), eq(jobs.rubricStatus, "ready"), eq(jobs.rubricVersion, job.version)))
				.returning(jobColumns),
			recalculateScores(db, jobId),
		]);
		if (saved) return saved;
	}
	return "rubric_not_ready";
}

// A recruiter's changes to requirements on the job: weight, label, or removal. Ids of requirements that aren't on the
// job (never were, or were removed) are unknown, and at least one requirement has to stay.
export function changeRubric(db: Db, orgId: string, jobId: string, changes: z.output<typeof rubricChangesInput>["changes"]) {
	return editRubric(db, orgId, jobId, (rubric) => {
		const byId = new Map(changes.map((change) => [change.id, change]));
		const visible = new Set(visibleItems(rubric).map(({ id }) => id));
		if (changes.some(({ id }) => !visible.has(id))) return "unknown_requirement";
		const next = rubric.map((item): RubricItem => {
			const change = byId.get(item.id);
			if (!change) return item;
			if (change.removed) return { ...item, removed: true };
			return { ...item, ...(change.weight && { weight: change.weight }), ...(change.label && { label: change.label }) };
		});
		return visibleItems(next).length === 0 ? "rubric_empty" : next;
	});
}

// A requirement a recruiter adds. It gets a new id, so no CV has evidence for it until it is checked.
export async function addRequirement(
	db: Db,
	orgId: string,
	jobId: string,
	input: z.output<typeof newRequirementInput>,
): Promise<{ job: Job; item: RubricItem } | RubricEditError> {
	let item: RubricItem | undefined;
	const job = await editRubric(db, orgId, jobId, (rubric) => {
		if (visibleItems(rubric).length >= RUBRIC_MAX_ITEMS) return "rubric_full";
		item = { id: nextRequirementId(rubric), ...input };
		return [...rubric, item];
	});
	// `item` is the one the write that landed was made with.
	return typeof job === "string" ? job : { job, item: item! };
}
