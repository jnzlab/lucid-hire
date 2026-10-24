import {
	type Check,
	DETAIL_MAX,
	type EvidenceLevel,
	LABEL_MAX,
	type RubricItem,
	type Weight,
	compareRanked,
	gapLabels,
	matchLabels,
	scoreChecks,
	visibleItems,
} from "@lucid-hire/scoring";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.ts";
import type { Candidate, CandidateList, CandidateSummary } from "./candidates.ts";

// A job's requirements (its "rubric") on the web side: what a change does to the job and to its CVs' rows, worked out
// with @lucid-hire/scoring so the page and the API always agree, and the changes still on their way to the API.
// Only types come from candidates.ts and jobs.ts, so both can use this file.

export type RubricStatus = "none" | "drafting" | "ready" | "failed";
// One edit as PATCH /jobs/:id/rubric takes it. Changes to the same requirement fold into one.
export type RubricChange = { id: string; weight?: Weight; label?: string; removed?: true };

export const WEIGHT_LABEL: Record<Weight, string> = { must: "Must", nice: "Nice", off: "Off" };
// What a level is called in sentences and accessible names; null is a requirement the CV hasn't been checked against.
export const levelWord = (level: EvidenceLevel | null) => (level === null ? "not checked" : level);
// The accessible name of one evidence square: "SwiftUI: partial", with ", off" for a requirement that doesn't count.
export const squareLabel = ({ label, level, weight }: Pick<Check, "label" | "level" | "weight">) =>
	`${label}: ${levelWord(level)}${weight === "off" ? ", off" : ""}`;
// How often the job page asks again while the requirements are being drafted.
export const RUBRIC_POLL_MS = 3000;

// The same rule the API applies to a label: 1 to 40 characters once trimmed. Null when it's fine.
export function checkLabel(raw: string): string | null {
	const label = raw.trim();
	if (!label) return "Enter a name for this requirement";
	if (label.length > LABEL_MAX) return `Keep the name to ${LABEL_MAX} characters`;
	return null;
}

// The API's rule for what a CV is checked against: 1 to 300 characters once trimmed.
export function checkDetail(raw: string): string | null {
	const detail = raw.trim();
	if (!detail) return "Say what a CV should show for this requirement";
	if (detail.length > DETAIL_MAX) return `Keep it to ${DETAIL_MAX} characters`;
	return null;
}

// Folds changes to the same requirement into one, later ones winning, in the order each requirement was first changed.
export function squash(changes: readonly RubricChange[]): RubricChange[] {
	const byId = new Map<string, RubricChange>();
	for (const change of changes) byId.set(change.id, { ...byId.get(change.id), ...change });
	return [...byId.values()];
}

export function applyChanges(rubric: readonly RubricItem[], changes: readonly RubricChange[]): RubricItem[] {
	const byId = new Map(squash(changes).map((change) => [change.id, change]));
	return rubric.map((item) => {
		const change = byId.get(item.id);
		if (!change) return item;
		const next: RubricItem = { ...item };
		if (change.weight) next.weight = change.weight;
		if (change.label !== undefined) next.label = change.label.trim();
		if (change.removed) next.removed = true;
		return next;
	});
}

// Whether a change would leave the requirement as it is in `rubric`, as a Must → Nice → Must run of clicks does.
export function changesNothing(change: RubricChange, rubric: readonly RubricItem[]): boolean {
	const item = rubric.find(({ id }) => id === change.id);
	if (!item) return false;
	return (
		(change.weight === undefined || change.weight === item.weight) &&
		(change.label === undefined || change.label.trim() === item.label) &&
		(!change.removed || item.removed === true)
	);
}

// A row the job's requirements score: scored by the current scorer, so it has checks. A CV scored before the job had
// requirements keeps its old score, and one that isn't scored has nothing to re-score.
const scoredByRubric = (row: Pick<CandidateSummary, "status" | "scoredBeforeRequirements" | "checks">) =>
	row.status === "scored" && !row.scoredBeforeRequirements && row.checks.length > 0;

// The checks a CV has against `rubric`: its levels stay with their requirement (by id); a requirement it hasn't been
// checked against is null.
function checksAgainst(rubric: readonly RubricItem[], levels: ReadonlyMap<string, Check["level"]>): Check[] {
	return visibleItems(rubric).map(({ id, label, weight }) => ({ id, label, weight, level: levels.get(id) ?? null }));
}

// A row as the API will answer it after the change: the checks follow the requirements, and the score, matches and
// gaps come from the shared formula.
export function rescoreRow<T extends CandidateSummary>(row: T, rubric: readonly RubricItem[]): T {
	if (!scoredByRubric(row)) return row;
	const checks = checksAgainst(rubric, new Map(row.checks.map(({ id, level }) => [id, level])));
	return { ...row, checks, score: scoreChecks(checks), matches: matchLabels(checks), gaps: gapLabels(checks) };
}

// THE order (compareRanked) and the API's rule for a rank: scored CVs first, best first, and only those with a score
// are numbered. CVs still being read and failed ones keep their place after them, as the API orders them.
export function rerank(rows: readonly CandidateSummary[]): CandidateSummary[] {
	let rank = 0;
	const scored = rows
		.filter(({ status }) => status === "scored")
		.toSorted(compareRanked)
		.map((row) => {
			const next = row.score === null ? null : ++rank;
			return next === row.rank ? row : { ...row, rank: next };
		});
	return [...scored, ...rows.filter(({ status }) => status !== "scored")];
}

export function rescoreList(list: CandidateList, rubric: readonly RubricItem[]): CandidateList {
	return { ...list, candidates: rerank(list.candidates.map((row) => rescoreRow(row, rubric))) };
}

// The candidate's page after the change: its evidence follows the requirements, its score is worked out again, and
// its rank comes from the re-ranked list when there is one.
export function rescoreCandidate(candidate: Candidate, rubric: readonly RubricItem[], list?: CandidateList): Candidate {
	let next = candidate;
	if (candidate.evidence && !candidate.scoredBeforeRequirements) {
		const found = new Map(candidate.evidence.map((entry) => [entry.id, entry]));
		const evidence = visibleItems(rubric).map(({ id, label, detail, weight }) => ({
			id,
			label,
			detail,
			weight,
			level: found.get(id)?.level ?? null,
			quote: found.get(id)?.quote ?? "",
		}));
		const checks = evidence.map(({ id, label, weight, level }) => ({ id, label, weight, level }));
		next = { ...candidate, evidence, checks, matches: matchLabels(checks), gaps: gapLabels(checks) };
		if (candidate.status === "scored") next.score = scoreChecks(checks);
	}
	const row = list?.candidates.find(({ id }) => id === candidate.id);
	if (list && row) {
		next = { ...next, rank: row.rank, rankedCount: list.candidates.filter(({ rank }) => rank !== null).length };
	}
	return next;
}

// How far each ranked CV moved: +2 is up two places. Rows that gained or lost their rank didn't move.
export function movesBetween(before: readonly CandidateSummary[], after: readonly CandidateSummary[]): Map<string, number> {
	const was = new Map(before.map(({ id, rank }) => [id, rank]));
	const moves = new Map<string, number>();
	for (const { id, rank } of after) {
		const previous = was.get(id);
		if (rank !== null && previous != null && previous !== rank) moves.set(id, previous - rank);
	}
	return moves;
}

// CVs a "Check all" would read: scored by the current scorer, not already being checked, and missing a level for at
// least one of the job's requirements (the API's rule for POST /jobs/:id/rubric/check).
export const needsCheck = (row: CandidateSummary) =>
	scoredByRubric(row) && !row.checking && row.checks.some(({ level }) => level === null);

// What the recruiter reads when a requirements call fails. The API's own message is already plain, so it is the
// fallback; these say what to do next for the codes the page can expect.
export const RUBRIC_ERRORS = {
	job_not_found: "This job doesn't exist any more. It may have been deleted.",
	// Also what the API says when two edits to the list collide.
	rubric_not_ready: "The requirements can't be changed right now. Try again in a moment.",
	rubric_drafting: "The requirements are already being drafted. They'll show here when they're ready.",
	unknown_requirement: "That requirement isn't on this job any more. Reload the page to see the latest list.",
	rubric_empty: "A job needs at least one requirement. Add another before you remove this one.",
	rubric_full: "This job already has 15 requirements. Remove one to add another.",
} satisfies Record<string, string>;
export function rubricErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "invalid_input") return Object.values(error.fields)[0] ?? error.message;
		return (error.code && (RUBRIC_ERRORS as Record<string, string>)[error.code]) || error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

// The changes made on this page that the API hasn't confirmed yet, per job, so a list or job that arrives meanwhile
// (a poll, say) shows them too instead of flicking back. Kept per query client, as tests make a new one each time.
export type RubricQueue = {
	// Folded changes not sent yet, and the batch on its way.
	pending: RubricChange[];
	sending: RubricChange[];
	// The requirements as the API last confirmed them: what a failed change goes back to.
	confirmed: RubricItem[];
	// The promises of the changes in `pending`, settled with the batch they go out in.
	waiting: { resolve: () => void; reject: (error: unknown) => void }[];
	// Whether a batch is on its way; the next one goes when it is answered.
	running: boolean;
};
const queues = new WeakMap<QueryClient, Map<string, RubricQueue>>();
const queueKey = (userId: string | null | undefined, jobId: string) => `${userId ?? ""}/${jobId}`;

export function rubricQueue(client: QueryClient, userId: string | null | undefined, jobId: string): RubricQueue | undefined {
	return queues.get(client)?.get(queueKey(userId, jobId));
}
export function openRubricQueue(
	client: QueryClient,
	userId: string | null | undefined,
	jobId: string,
	confirmed: RubricItem[],
): RubricQueue {
	const existing = rubricQueue(client, userId, jobId);
	if (existing) return existing;
	const queue: RubricQueue = { pending: [], sending: [], confirmed, waiting: [], running: false };
	if (!queues.has(client)) queues.set(client, new Map());
	queues.get(client)!.set(queueKey(userId, jobId), queue);
	return queue;
}
export function closeRubricQueue(client: QueryClient, userId: string | null | undefined, jobId: string) {
	queues.get(client)?.delete(queueKey(userId, jobId));
}

// The requirements with this page's unconfirmed changes on top. A batch on its way is included: the API applies it
// whether this answer was read before or after it.
export function withPendingChanges(
	client: QueryClient,
	userId: string | null | undefined,
	jobId: string,
	rubric: RubricItem[] | null,
): RubricItem[] | null {
	const queue = rubricQueue(client, userId, jobId);
	if (!queue || !rubric) return rubric;
	return applyChanges(rubric, [...queue.sending, ...queue.pending]);
}
