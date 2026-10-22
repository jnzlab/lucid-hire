import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError, apiDelete, apiGet, apiGetBlob, apiPatch, apiPost, apiUploadPdf } from "./api.ts";
import { jobKey, jobsKey } from "./jobs.ts";
import { useSession } from "./session.ts";

// The same limits the API enforces (apps/api/src/candidates.ts), checked before anything is sent.
export const CV_LIMIT_PER_JOB = 10;
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_SCORING_RUNS = 3;
export const CANDIDATE_STATUSES = ["queued", "scoring", "scored", "failed"] as const;
export const CANDIDATE_DECISIONS = ["undecided", "shortlisted", "rejected"] as const;
// The longest note the API takes (apps/api/src/candidates.ts).
export const NOTE_MAX = 1000;

// A temporary link to a CV is revoked after this long, by when the tab or the download has it.
export const CV_URL_REVOKE_MS = 60_000;
export const OPEN_CV_FAILED = "We couldn't open the CV. Try again.";

// How often the lists re-ask the API while a CV is still being read.
export const CANDIDATE_POLL_MS = 3000;
// Reading a CV takes 10 to 80 seconds. After this long the page says it is taking longer than usual.
export const SLOW_READ_MS = 5 * 60_000;
// How often a CV that is being read is checked against SLOW_READ_MS.
export const SLOW_CHECK_MS = 30_000;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export type Decision = (typeof CANDIDATE_DECISIONS)[number];
export const DECISION_LABEL: Record<Decision, string> = {
	undecided: "Undecided",
	shortlisted: "Shortlisted",
	rejected: "Rejected",
};
export type Requirement = {
	label: string;
	requirement: string;
	importance: "must" | "nice";
	met: boolean;
	// A verbatim quote from the CV. Empty when the requirement isn't met.
	evidence: string;
};
export type CandidateSummary = {
	id: string;
	fileName: string;
	status: CandidateStatus;
	// The recruiters' call on this CV, whatever its status.
	decision: Decision;
	name: string | null;
	headline: string | null;
	score: number | null;
	// Labels of met requirements (must-haves first, at most 4) and of unmet must-haves (at most 2).
	matches: string[];
	gaps: string[];
	error: string | null;
	canRetry: boolean;
	createdAt: string;
	// When the status last changed, if the API sends it. Without it, "taking longer than usual" counts from createdAt.
	updatedAt?: string;
	scoredAt: string | null;
};
export type Candidate = CandidateSummary & {
	summary: string | null;
	requirements: Requirement[] | null;
	fileSize: number;
	note: string | null;
	// When the decision last changed. Null while it is undecided.
	decidedAt: string | null;
};
export type CandidateList = { candidates: CandidateSummary[]; cvCount: number; cvLimit: number };

// Keyed by user, like the jobs. The list key is a prefix of every candidate's key.
type Nullable = string | null | undefined;
const listKey = (userId: Nullable, jobId: string) => ["candidates", userId, jobId] as const;
const candidateKey = (userId: Nullable, jobId: string, id: string) => ["candidates", userId, jobId, id] as const;

export const isWorking = ({ status }: { status: CandidateStatus }) => status === "queued" || status === "scoring";

// Still being read after SLOW_READ_MS, counted from upload.
export const isSlow = (candidate: Pick<CandidateSummary, "status" | "createdAt" | "updatedAt">, now = Date.now()) =>
	isWorking(candidate) && now - Date.parse(candidate.updatedAt ?? candidate.createdAt) > SLOW_READ_MS;

// What a failed CV says. The API words its message for a CV that can be tried again, and keeps it when the CV has
// no runs left, so "Try again" is dropped unless Retry is on offer.
export function failureMessage({ error, canRetry }: Pick<CandidateSummary, "error" | "canRetry">) {
	const message = error ?? "Scoring failed. Try again.";
	return canRetry ? message : message.replace(/\s*Try again\.?$/, "");
}

// The name from the CV, or the file name until the CV has been read (or when it has no name on it).
export const candidateName = ({ name, fileName }: Pick<CandidateSummary, "name" | "fileName">) =>
	name?.trim() || fileName;

// The same checks the API makes, in the same words. `slotsLeft` is what the job can still take.
export function checkCv(file: File, slotsLeft: number): string | null {
	// Some systems give dropped files an empty type, so only a different, known type is refused.
	if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Upload a PDF file";
	if (file.size === 0) return "That file is empty";
	if (file.size > CV_MAX_BYTES) return "Each CV must be 5 MB or smaller";
	if (slotsLeft <= 0) return `This job has used its ${CV_LIMIT_PER_JOB} free CVs`;
	return null;
}

// A CV that was just queued ranks after the ones read or being read, and before the failed ones.
function withQueued(list: CandidateList, candidate: CandidateSummary): CandidateList["candidates"] {
	const rest = list.candidates.filter(({ id }) => id !== candidate.id);
	const firstFailed = rest.findIndex(({ status }) => status === "failed");
	return rest.toSpliced(firstFailed === -1 ? rest.length : firstFailed, 0, candidate);
}

// Ranked best first, as the API orders it. Polls while any CV is still being read.
export function useCandidates(jobId: string) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: listKey(userId, jobId),
		queryFn: async ({ signal }) => apiGet<CandidateList>(`/jobs/${jobId}/candidates`, { token: await token(), signal }),
		refetchInterval: ({ state }) => (state.data?.candidates.some(isWorking) ? CANDIDATE_POLL_MS : false),
	});
}

// `enabled` is off while the candidate is being deleted, so no poll can ask for it once it is gone.
export function useCandidate(jobId: string, id: string, enabled = true) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: candidateKey(userId, jobId, id),
		enabled,
		queryFn: async ({ signal }) =>
			(await apiGet<{ candidate: Candidate }>(`/jobs/${jobId}/candidates/${id}`, { token: await token(), signal }))
				.candidate,
		refetchInterval: ({ state }) => (state.data && isWorking(state.data) ? CANDIDATE_POLL_MS : false),
		retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status === 404),
	});
}

export type DecideInput = { decision?: Decision; note?: string | null };

// What the API will answer for this change, so the page can show it before the answer arrives: the note is
// trimmed (an empty one is none), and the decision's time changes only when the decision does.
function decided(candidate: Candidate, { decision, note }: DecideInput): Candidate {
	const next = { ...candidate };
	if (note !== undefined) next.note = note?.trim() || null;
	if (decision !== undefined) {
		if (decision !== candidate.decision) next.decidedAt = decision === "undecided" ? null : new Date().toISOString();
		next.decision = decision;
	}
	return next;
}

// Shortlists, rejects or un-decides a CV, and saves its note. Both pages show the change at once and put it back
// if the API refuses. Changes to one CV go to the API one at a time, in the order they were made.
export function useDecideCandidate(jobId: string, id: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const mutationKey = ["decide", userId, jobId, id];
	const detailKey = candidateKey(userId, jobId, id);
	const listQueryKey = listKey(userId, jobId);

	const setDecision = (decision: Decision) =>
		queryClient.setQueryData<CandidateList>(
			listQueryKey,
			(list) =>
				list && { ...list, candidates: list.candidates.map((row) => (row.id === id ? { ...row, decision } : row)) },
		);

	return useMutation({
		mutationKey,
		scope: { id: mutationKey.join("/") },
		mutationFn: async (input: DecideInput) =>
			(await apiPatch<{ candidate: Candidate }>(`/jobs/${jobId}/candidates/${id}`, input, { token: await token() }))
				.candidate,
		onMutate: async (input) => {
			// A fetch already on its way would land after this and show the old answer.
			await Promise.all([
				queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
				queryClient.cancelQueries({ queryKey: listQueryKey, exact: true }),
			]);
			const before = queryClient.getQueryData<Candidate>(detailKey);
			const row = queryClient.getQueryData<CandidateList>(listQueryKey)?.candidates.find((c) => c.id === id);
			queryClient.setQueryData<Candidate>(detailKey, (candidate) => candidate && decided(candidate, input));
			if (input.decision !== undefined) setDecision(input.decision);
			return { decision: before?.decision ?? row?.decision, note: before?.note };
		},
		// Puts back only what this change touched, so a poll that landed meanwhile isn't undone.
		onError: (_error, input, previous) => {
			if (input.decision !== undefined && previous?.decision !== undefined) {
				const { decision } = previous;
				setDecision(decision);
				queryClient.setQueryData<Candidate>(detailKey, (candidate) => candidate && { ...candidate, decision });
			}
			if (input.note !== undefined && previous?.note !== undefined) {
				const { note } = previous;
				queryClient.setQueryData<Candidate>(detailKey, (candidate) => candidate && { ...candidate, note });
			}
		},
		// Also after a refusal: the page then shows what the API holds. While more changes are on their way,
		// only the last one asks, or the page would flick back to a state that is about to change.
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey }) > 1) return;
			void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
			void queryClient.invalidateQueries({ queryKey: listQueryKey, exact: true });
		},
	});
}

// Opens the CV's PDF in a new tab. The tab has to be opened inside the click, or the browser takes it for a
// popup and blocks it; the PDF is fetched with the session token after that, so the tab starts blank. When the
// browser blocks the tab anyway, the PDF downloads instead.
export function useOpenCv(jobId: string, id: string, fileName: string) {
	const { token } = useSession();
	const mutation = useMutation({
		mutationFn: async (tab: Window | null) => {
			const blob = await apiGetBlob(`/jobs/${jobId}/candidates/${id}/cv`, { token: await token() });
			const url = URL.createObjectURL(blob);
			if (tab) {
				tab.location.href = url;
			} else {
				const link = document.createElement("a");
				link.href = url;
				link.download = fileName;
				document.body.append(link);
				link.click();
				link.remove();
			}
			// By then the tab has the file, or the download has started.
			setTimeout(() => URL.revokeObjectURL(url), CV_URL_REVOKE_MS);
		},
		onError: (_error, tab) => tab?.close(),
	});
	return {
		open: () => {
			if (!mutation.isPending) mutation.mutate(window.open("", "_blank"));
		},
		isPending: mutation.isPending,
		error: mutation.isError ? OPEN_CV_FAILED : null,
	};
}

export type UploadItem = {
	key: number;
	fileName: string;
	state: "waiting" | "uploading" | "done" | "failed";
	// Why a file wasn't uploaded, in words the recruiter can act on.
	error?: string;
};

// Uploads the chosen PDFs one after another and reports each file's state. A file that fails the
// client checks or the API doesn't stop the others.
export function useUploadCvs(jobId: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const [items, setItems] = useState<UploadItem[]>([]);
	const nextKey = useRef(0);
	const running = useRef(false);

	const patch = (key: number, change: Partial<UploadItem>) =>
		setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

	const upload = async (files: File[], slotsLeft: number) => {
		if (running.current || files.length === 0) return;
		running.current = true;

		let free = slotsLeft;
		const batch = files.map((file) => {
			const error = checkCv(file, free);
			if (!error) free -= 1;
			const item: UploadItem = {
				key: nextKey.current++,
				fileName: file.name,
				state: error ? "failed" : "waiting",
				error: error ?? undefined,
			};
			return { file, item };
		});
		setItems(batch.map(({ item }) => item));

		const key = listKey(userId, jobId);
		// Once the API says the job can't take more CVs, the rest of the batch is not sent.
		let refusal: string | null = null;
		for (const { file, item } of batch) {
			if (item.state === "failed") continue;
			if (refusal) {
				patch(item.key, { state: "failed", error: refusal });
				continue;
			}
			patch(item.key, { state: "uploading" });
			try {
				const { candidate } = await apiUploadPdf<{ candidate: Candidate }>(
					`/jobs/${jobId}/candidates?fileName=${encodeURIComponent(file.name)}`,
					file,
					{ token: await token() },
				);
				// Show it in the list at once; the refetch below brings the server's order and counts. A list
				// fetch still in flight would land after this and wipe the new row, so stop it first.
				await queryClient.cancelQueries({ queryKey: key, exact: true });
				queryClient.setQueryData<CandidateList>(
					key,
					(list) => list && { ...list, candidates: withQueued(list, candidate), cvCount: list.cvCount + 1 },
				);
				patch(item.key, { state: "done" });
			} catch (error) {
				if (error instanceof ApiError && (error.code === "cv_limit" || error.code === "job_not_open")) {
					refusal = error.message;
				}
				patch(item.key, {
					state: "failed",
					error: error instanceof ApiError ? error.message : "We couldn't upload that file. Try again.",
				});
			}
		}

		running.current = false;
		void queryClient.invalidateQueries({ queryKey: key, exact: true });
		// The job's own CV count, and its status if the API found it closed.
		void queryClient.invalidateQueries({ queryKey: jobsKey(userId), exact: true });
		void queryClient.invalidateQueries({ queryKey: jobKey(userId, jobId), exact: true });
	};

	return { items, upload, clear: () => setItems([]) };
}

// Runs the scoring again for a CV that failed. The row goes back to "queued" at once, which starts the polling.
export function useRetryCandidate(jobId: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) =>
			(
				await apiPost<{ candidate: Candidate }>(`/jobs/${jobId}/candidates/${id}/retry`, undefined, {
					token: await token(),
				})
			).candidate,
		onSuccess: (candidate) => {
			queryClient.setQueryData(candidateKey(userId, jobId, candidate.id), candidate);
			queryClient.setQueryData<CandidateList>(
				listKey(userId, jobId),
				(list) => list && { ...list, candidates: withQueued(list, candidate) },
			);
		},
		// Also after a refusal: what the recruiter clicked in was out of date.
		onSettled: (_candidate, _error, id) => {
			void queryClient.invalidateQueries({ queryKey: listKey(userId, jobId), exact: true });
			void queryClient.invalidateQueries({ queryKey: candidateKey(userId, jobId, id), exact: true });
		},
	});
}

export function useDeleteCandidate(jobId: string, id: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => apiDelete(`/jobs/${jobId}/candidates/${id}`, { token: await token() }),
		onSuccess: () => {
			// Drop it from the cached list too, or the job page shows it until the refetch lands.
			// The job's CV count stays: a deleted CV doesn't give its free slot back.
			queryClient.setQueryData<CandidateList>(
				listKey(userId, jobId),
				(list) => list && { ...list, candidates: list.candidates.filter((candidate) => candidate.id !== id) },
			);
			// Its own page keeps showing it until we navigate away, so it is only marked stale, not removed.
			// The next visit refetches and gets "doesn't exist".
			void queryClient.cancelQueries({ queryKey: candidateKey(userId, jobId, id), exact: true });
			void queryClient.invalidateQueries({
				queryKey: candidateKey(userId, jobId, id),
				exact: true,
				refetchType: "none",
			});
			void queryClient.invalidateQueries({ queryKey: listKey(userId, jobId), exact: true });
		},
	});
}
