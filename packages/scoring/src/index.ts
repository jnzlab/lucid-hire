// The one definition of how a CV's score comes from its job's requirements and the CV's evidence. The API stores
// scores with it (and mirrors it in SQL when a job's weights change), the job page re-ranks with it the moment a
// recruiter changes a weight, and the landing demo uses it, so a score can never be worked out two ways.

export const WEIGHTS = ["must", "nice", "off"] as const;
export type Weight = (typeof WEIGHTS)[number];
// A must-have counts three times a nice-to-have; an Off requirement doesn't count at all.
export const WEIGHT_VALUE: Record<Weight, number> = { must: 3, nice: 1, off: 0 };

export const EVIDENCE_LEVELS = ["clear", "partial", "none"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
// Partial evidence counts half. A requirement the CV hasn't been checked against yet counts as none.
export const LEVEL_VALUE: Record<EvidenceLevel, number> = { clear: 1, partial: 0.5, none: 0 };

// Limits shared by the drafting prompt, the API's validation and the requirements editor.
export const RUBRIC_MIN_ITEMS = 1;
export const RUBRIC_MAX_ITEMS = 15;
export const LABEL_MAX = 40;
export const DETAIL_MAX = 300;
export const QUOTE_MAX = 200;

// One requirement of a job. `id` is stable for the life of the job and never reused, so evidence keyed by it stays
// attached while weights and labels change. `detail` is what a CV is checked against: new wording is a new
// requirement with a new id. A removed requirement keeps its id, so its old evidence can't attach to another.
export type RubricItem = { id: string; label: string; detail: string; weight: Weight; removed?: true };

// What one CV shows for one requirement. `quote` is verbatim from the CV, and empty when the level is none.
export type Evidence = { level: EvidenceLevel; quote: string };
// A CV's evidence by requirement id. A requirement with no entry hasn't been checked against this CV yet.
export type EvidenceMap = Record<string, Evidence>;

// One requirement as a CV's row shows it: the job's weight and the CV's level, null while not checked. Rows carry
// these so the browser can re-score and re-rank without asking the server.
export type Check = { id: string; label: string; weight: Weight; level: EvidenceLevel | null };

// The requirements still on the job, in the job's order (removed ones are gone; Off ones stay, they just don't count).
export const visibleItems = (rubric: readonly RubricItem[]) => rubric.filter((item) => !item.removed);

// The core sum, in plain numbers so the landing demo can use it as is: the weighted share of evidence out of 100.
// Null when nothing counts (every weight is 0), which leaves a CV unranked.
export function weightedScore(items: readonly { weight: number; value: number }[]): number | null {
	let earned = 0;
	let total = 0;
	for (const { weight, value } of items) {
		total += weight;
		earned += weight * value;
	}
	return total === 0 ? null : Math.round((100 * earned) / total);
}

export const scoreChecks = (checks: readonly Pick<Check, "weight" | "level">[]): number | null =>
	weightedScore(checks.map(({ weight, level }) => ({ weight: WEIGHT_VALUE[weight], value: level ? LEVEL_VALUE[level] : 0 })));

// A CV's checks against the job's current requirements, in the job's order.
export const toChecks = (rubric: readonly RubricItem[], evidence: Readonly<EvidenceMap>): Check[] =>
	visibleItems(rubric).map(({ id, label, weight }) => ({ id, label, weight, level: evidence[id]?.level ?? null }));

export const scoreEvidence = (rubric: readonly RubricItem[], evidence: Readonly<EvidenceMap>): number | null =>
	scoreChecks(toChecks(rubric, evidence));

// Ids of the job's requirements this CV hasn't been checked against (Off ones included: turning one back on
// shouldn't find it unchecked).
export const uncheckedIds = (rubric: readonly RubricItem[], evidence: Readonly<EvidenceMap>): string[] =>
	visibleItems(rubric)
		.filter(({ id }) => !evidence[id])
		.map(({ id }) => id);

const counts = (check: Check) => check.weight !== "off";
const MATCHES_MAX = 4;
const GAPS_MAX = 2;

// Labels of requirements the CV clearly meets, must-haves first, at most 4. Partial evidence is shown by the row's
// squares, not claimed as a match.
export const matchLabels = (checks: readonly Check[]): string[] =>
	checks
		.filter((check) => counts(check) && check.level === "clear")
		.sort((a, b) => Number(b.weight === "must") - Number(a.weight === "must"))
		.slice(0, MATCHES_MAX)
		.map(({ label }) => label);

// Labels of must-haves the CV shows no evidence for (none, or not checked yet), at most 2.
export const gapLabels = (checks: readonly Check[]): string[] =>
	checks
		.filter((check) => check.weight === "must" && (check.level === null || check.level === "none"))
		.slice(0, GAPS_MAX)
		.map(({ label }) => label);

// THE ranking order, the same one the API sorts by: higher score first, then whoever was scored first, then whoever
// uploaded first, then the id so that two rows never tie. Unscored rows (null score) go last.
export type Rankable = { id: string; score: number | null; scoredAt: string | null; createdAt: string };
export function compareRanked(a: Rankable, b: Rankable): number {
	if (a.score !== b.score) {
		if (a.score === null) return 1;
		if (b.score === null) return -1;
		return b.score - a.score;
	}
	const scored = (a.scoredAt ?? "").localeCompare(b.scoredAt ?? "");
	if (scored) return scored;
	const created = a.createdAt.localeCompare(b.createdAt);
	if (created) return created;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The id for a requirement added to this job: one past the highest ever used, removed ones included.
export function nextRequirementId(rubric: readonly RubricItem[]): string {
	const highest = rubric.reduce((max, { id }) => Math.max(max, Number(/^r(\d+)$/.exec(id)?.[1] ?? 0)), 0);
	return `r${highest + 1}`;
}
