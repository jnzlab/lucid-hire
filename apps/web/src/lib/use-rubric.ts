import type { RubricItem, Weight } from "@lucid-hire/scoring";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "./api.ts";
import { type Candidate, type CandidateList, invalidateAround, listKey } from "./candidates.ts";
import { type Job, jobKey } from "./jobs.ts";
import {
	type RubricChange,
	type RubricQueue,
	applyChanges,
	changesNothing,
	closeRubricQueue,
	movesBetween,
	needsCheck,
	openRubricQueue,
	rescoreCandidate,
	rescoreList,
	rubricQueue,
	squash,
	withPendingChanges,
} from "./rubric.ts";
import { useSession } from "./session.ts";

// How far each ranked CV moved in the change that was just shown: +2 is up two places.
export type Moves = ReadonlyMap<string, number>;

type Context = { client: QueryClient; userId: string | null | undefined; jobId: string; token: () => Promise<string | null> };

// Puts `rubric` on the cached job (or `job` with it, when the API sent one), then re-scores and re-ranks the job's
// cached list and every cached candidate of the job with it. Nothing waits on the network, which is the point: the list
// re-ranks the moment a weight changes.
function showRubric({ client, userId, jobId }: Context, rubric: RubricItem[], job?: Job): Moves {
	client.setQueryData<Job>(jobKey(userId, jobId), (cached) => (job ? { ...job, rubric } : cached && { ...cached, rubric }));
	const before = client.getQueryData<CandidateList>(listKey(userId, jobId));
	const after = before && rescoreList(before, rubric);
	if (after) client.setQueryData(listKey(userId, jobId), after);
	for (const [key, candidate] of client.getQueriesData<Candidate>({ queryKey: listKey(userId, jobId) })) {
		if (key.length === 4 && candidate) client.setQueryData(key, rescoreCandidate(candidate, rubric, after));
	}
	return before && after ? movesBetween(before.candidates, after.candidates) : new Map();
}

// After a change has been answered: the job's CVs, their scores in the jobs list, the overview, the candidates page
// and the palette's search all ask again.
function settle({ client, userId, jobId }: Context) {
	void client.invalidateQueries({ queryKey: listKey(userId, jobId) });
	void client.invalidateQueries({ queryKey: jobKey(userId, jobId), exact: true });
	invalidateAround(client, userId);
}

// Sends the folded changes one batch at a time until none are left. Clicks made while a batch is on its way fold into
// the next one, so a run of clicks costs two requests at most and the last one carries the final state. A batch that
// changes nothing (Must → Nice → Must) isn't sent. If a batch fails, everything not yet confirmed goes back to what the
// API last confirmed, so the page never shows a state the API doesn't hold.
async function send(context: Context, queue: RubricQueue) {
	const { client, userId, jobId, token } = context;
	queue.running = true;
	while (queue.pending.length > 0) {
		const batch = queue.pending;
		const waiters = queue.waiting;
		queue.pending = [];
		queue.waiting = [];
		queue.sending = batch;
		const changes = batch.filter((change) => !changesNothing(change, queue.confirmed));
		try {
			if (changes.length > 0) {
				const { job } = await apiPatch<{ job: Job }>(`/jobs/${jobId}/rubric`, { changes }, { token: await token() });
				if (job.rubric) queue.confirmed = job.rubric;
				queue.sending = [];
				// While more changes wait, the page already shows them and this answer doesn't have them yet.
				if (queue.pending.length === 0 && job.rubric) showRubric(context, job.rubric, job);
			}
			queue.sending = [];
			for (const waiter of waiters) waiter.resolve();
		} catch (error) {
			const failed = [...waiters, ...queue.waiting];
			closeRubricQueue(client, userId, jobId);
			showRubric(context, queue.confirmed);
			for (const waiter of failed) waiter.reject(error);
			settle(context);
			return;
		}
	}
	closeRubricQueue(client, userId, jobId);
	settle(context);
}

// Changes requirements (weights, labels, removals) on the page at once and saves them in the background. `moves` says
// how the list re-ranked; `done` settles when the API has the change, and rejects (with the page already put back)
// when it refused it. A run of changes that fails rejects every one of their promises with the same error.
export function useRubricChanges(jobId: string) {
	const { userId, token } = useSession();
	const client = useQueryClient();
	return (changes: RubricChange[]): { moves: Moves; done: Promise<void> } => {
		const context: Context = { client, userId, jobId, token };
		const rubric = client.getQueryData<Job>(jobKey(userId, jobId))?.rubric;
		if (!rubric) return { moves: new Map(), done: Promise.resolve() };
		const queue = openRubricQueue(client, userId, jobId, rubric);
		queue.pending = squash([...queue.pending, ...changes]);
		const done = new Promise<void>((resolve, reject) => queue.waiting.push({ resolve, reject }));
		const moves = showRubric(context, applyChanges(rubric, changes));
		if (!queue.running) void send(context, queue);
		return { moves, done };
	};
}

// A job the API answered with outside the queue (a new requirement): it becomes what the API last confirmed, with
// any changes still on their way on top.
function adopt(context: Context, job: Job): Moves {
	const { client, userId, jobId } = context;
	const queue = rubricQueue(client, userId, jobId);
	if (queue && job.rubric) queue.confirmed = job.rubric;
	const rubric = withPendingChanges(client, userId, jobId, job.rubric);
	if (rubric) return showRubric(context, rubric, job);
	client.setQueryData(jobKey(userId, jobId), job);
	return new Map();
}

export type NewRequirement = { label: string; detail: string; weight: Weight };

// Adds a requirement. It starts as not checked on every CV (counting as none), so the scores and the order change
// at once, and the page offers to check the CVs against it.
export function useAddRequirement(jobId: string) {
	const { userId, token } = useSession();
	const client = useQueryClient();
	const context: Context = { client, userId, jobId, token };
	return useMutation({
		mutationFn: async (input: NewRequirement) => {
			const { job, item } = await apiPost<{ job: Job; item: RubricItem }>(
				`/jobs/${jobId}/rubric/requirements`,
				{ ...input, label: input.label.trim(), detail: input.detail.trim() },
				{ token: await token() },
			);
			return { item, moves: adopt(context, job) };
		},
		onSettled: () => settle(context),
	});
}

// Reads every CV that is missing evidence for a requirement again, against all of them: one AI read per CV. Its rows
// say "Checking" at once, and the list asks again until every one is done.
export function useCheckAll(jobId: string) {
	const { userId, token } = useSession();
	const client = useQueryClient();
	return useMutation({
		mutationFn: async () =>
			(await apiPost<{ started: number }>(`/jobs/${jobId}/rubric/check`, undefined, { token: await token() })).started,
		onSuccess: () => {
			client.setQueryData<CandidateList>(
				listKey(userId, jobId),
				(list) => list && { ...list, candidates: list.candidates.map((row) => (needsCheck(row) ? { ...row, checking: true } : row)) },
			);
		},
		onSettled: () => void client.invalidateQueries({ queryKey: listKey(userId, jobId), exact: true }),
	});
}

// Drafts the requirements from the job's title and description, or drafts them again. The job comes back as
// drafting, and useJob asks again until the draft lands; or as failed already, when the draft couldn't start.
export function useDraftRubric(jobId: string) {
	const { userId, token } = useSession();
	const client = useQueryClient();
	return useMutation({
		mutationFn: async () =>
			(await apiPost<{ job: Job }>(`/jobs/${jobId}/rubric/draft`, undefined, { token: await token() })).job,
		onSuccess: (job) => client.setQueryData(jobKey(userId, jobId), job),
		// A refusal (already drafting, say) means the page was out of date.
		onError: () => void client.invalidateQueries({ queryKey: jobKey(userId, jobId), exact: true }),
	});
}
