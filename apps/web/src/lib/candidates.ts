import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiUploadPdf } from "./api.ts";
import { jobKey, jobsKey } from "./jobs.ts";
import { useSession } from "./session.ts";

// The same limits the API enforces (apps/api/src/candidates.ts), checked before anything is sent.
export const CV_LIMIT_PER_JOB = 10;
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_SCORING_RUNS = 3;
export const CANDIDATE_STATUSES = ["queued", "scoring", "scored", "failed"] as const;

// How often the lists re-ask the API while a CV is still being read.
export const CANDIDATE_POLL_MS = 3000;
// Reading a CV takes 10 to 80 seconds. After this long the page says it is taking longer than usual.
export const SLOW_READ_MS = 5 * 60_000;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
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

// The name from the CV, or the file name until the CV has been read (or when it has no name on it).
export const candidateName = ({ name, fileName }: Pick<CandidateSummary, "name" | "fileName">) =>
	name?.trim() || fileName;

export function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
