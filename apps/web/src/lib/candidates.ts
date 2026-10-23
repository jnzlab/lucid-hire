import { PLANS } from "@lucid-hire/plans";
import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type AllCandidatesList, allCandidatesKey } from "./all-candidates.ts";
import { ApiError, apiDelete, apiGet, apiGetBlob, apiGetFile, apiPatch, apiPost, apiUploadPdf } from "./api.ts";
import { jobKey, jobsKey } from "./jobs.ts";
import { overviewKey } from "./overview.ts";
import { forgetVisit } from "./recent.ts";
import { searchKey } from "./search.ts";
import { useSession } from "./session.ts";

// The same limits the API enforces (apps/api/src/candidates.ts), checked before anything is sent. The CV limit per
// job depends on the plan; the list sends it, and Free's limit stands in until it arrives.
export const CV_LIMIT_PER_JOB = PLANS.free.cvsPerJob;
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
// What the decisions are called on screen. `rejected` reads "Not a fit" everywhere.
export const DECISION_LABEL: Record<Decision, string> = {
	undecided: "Undecided",
	shortlisted: "Shortlisted",
	rejected: "Not a fit",
};
export type Requirement = {
	label: string;
	requirement: string;
	importance: "must" | "nice";
	met: boolean;
	// A verbatim quote from the CV. Empty when the requirement isn't met.
	evidence: string;
};
// What the CV states about the candidate, read when it was scored. Whatever the CV doesn't state is absent.
export type CandidateProfile = {
	email?: string;
	phone?: string;
	location?: string;
	links: { label?: string; url: string }[];
	skills: string[];
	experience: { title: string; company?: string; start?: string; end?: string; summary?: string }[];
	education: { qualification: string; institution?: string; year?: string }[];
	certifications: string[];
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
	// Place among the job's scored CVs (1 is best); null until the CV is scored. It belongs to the CV, so filtering
	// the list never renumbers it.
	rank: number | null;
	// Labels of met requirements (must-haves first, at most 4) and of unmet must-haves (at most 2).
	matches: string[];
	gaps: string[];
	// Every requirement of the job and whether the CV met it, for the row's "Show all requirements".
	checks: { label: string; met: boolean; importance: "must" | "nice" }[];
	// The AI's two sentences on the fit; the list searches them.
	summary: string | null;
	// Whether a recruiter has written a note on this CV.
	hasNote: boolean;
	// A recruiter's upload, or the applicant through the job's public page.
	source: "upload" | "apply";
	// The address the applicant gave when applying, else the one on the CV.
	email: string | null;
	// Only the email: the rest of the profile is on the candidate page.
	profile: { email?: string } | null;
	error: string | null;
	canRetry: boolean;
	createdAt: string;
	// When the status last changed, if the API sends it. Without it, "taking longer than usual" counts from createdAt.
	updatedAt?: string;
	scoredAt: string | null;
};
export type Candidate = Omit<CandidateSummary, "profile"> & {
	// How many of the job's CVs are ranked, for "#2 of 7".
	rankedCount: number;
	requirements: Requirement[] | null;
	fileSize: number;
	note: string | null;
	// When the decision last changed, and the Clerk user id of whoever changed it. Null while it is undecided.
	decidedAt: string | null;
	profile: CandidateProfile | null;
	decidedBy: string | null;
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

// The candidate's email, if we have one. Every screen and the CSV go through here, so there is one place to say
// where it comes from.
export const candidateEmail = (candidate: { email?: string | null; profile?: { email?: string } | null }): string | null =>
	candidate.email ?? candidate.profile?.email ?? null;

// The name from the CV, or the file name until the CV has been read (or when it has no name on it).
export const candidateName = ({ name, fileName }: Pick<CandidateSummary, "name" | "fileName">) =>
	name?.trim() || fileName;

// "CVs" on a paid plan, "free CVs" on Free, so a limit reads the way the plan promises it.
export const cvNoun = (limit: number) => (limit === PLANS.free.cvsPerJob ? "free CVs" : "CVs");

// The same checks the API makes, in the same words. `slotsLeft` is what the job can still take, of `limit`.
export function checkCv(file: File, slotsLeft: number, limit: number = CV_LIMIT_PER_JOB): string | null {
	// Some systems give dropped files an empty type, so only a different, known type is refused.
	if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Upload a PDF file";
	if (file.size === 0) return "That file is empty";
	if (file.size > CV_MAX_BYTES) return "Each CV must be 5 MB or smaller";
	if (slotsLeft <= 0) return `This job has used its ${limit} ${cvNoun(limit)}`;
	return null;
}

// A CV that was just queued ranks after the ones read or being read, and before the failed ones.
function withQueued(list: CandidateList, candidate: CandidateSummary): CandidateList["candidates"] {
	const rest = list.candidates.filter(({ id }) => id !== candidate.id);
	const firstFailed = rest.findIndex(({ status }) => status === "failed");
	return rest.toSpliced(firstFailed === -1 ? rest.length : firstFailed, 0, candidate);
}

// Every cached query that counts or lists CVs outside a job's own list: the candidates page, the overview (with the
// sidebar's to-review badges), the jobs lists' pipeline counts (with the sidebar's live dots) and the palette's search.
function invalidateAround(queryClient: QueryClient, userId: Nullable) {
	countsAskedAt.set(queryClient, Date.now());
	for (const queryKey of [allCandidatesKey(userId), overviewKey(userId), jobsKey(userId), searchKey(userId)]) {
		void queryClient.invalidateQueries({ queryKey });
	}
}

// While a job's CVs are being read, the counts elsewhere ask again as they finish: at once when the last one is done,
// and otherwise at most this often, since the overview and the open jobs poll on their own meanwhile.
const COUNTS_REFRESH_MS = 10_000;
const countsAskedAt = new WeakMap<QueryClient, number>();

// Whether a CV that was being read in `before` has been scored or has failed in `after`.
function finishedReading(before: CandidateList, after: CandidateList) {
	const working = new Set(before.candidates.filter(isWorking).map(({ id }) => id));
	return working.size > 0 && after.candidates.some((row) => working.has(row.id) && !isWorking(row));
}

// Ranked best first, as the API orders it. Polls while any CV is still being read, and when a CV finishes, the counts
// elsewhere catch up. That is checked in the fetch itself, so it happens once however many components show the list.
export function useCandidates(jobId: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const queryKey = listKey(userId, jobId);
	return useQuery({
		queryKey,
		queryFn: async ({ signal }) => {
			const before = queryClient.getQueryData<CandidateList>(queryKey);
			const list = await apiGet<CandidateList>(`/jobs/${jobId}/candidates`, { token: await token(), signal });
			if (before && finishedReading(before, list)) {
				const stillReading = list.candidates.some(isWorking);
				const askedAt = countsAskedAt.get(queryClient) ?? 0;
				if (!stillReading || Date.now() - askedAt >= COUNTS_REFRESH_MS) invalidateAround(queryClient, userId);
			}
			return list;
		},
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
function decided(candidate: Candidate, { decision, note }: DecideInput, userId: string | null | undefined): Candidate {
	const next = { ...candidate };
	if (note !== undefined) next.note = note?.trim() || null;
	if (decision !== undefined) {
		if (decision !== candidate.decision) {
			next.decidedAt = decision === "undecided" ? null : new Date().toISOString();
			next.decidedBy = decision === "undecided" ? null : (userId ?? null);
		}
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
			queryClient.setQueryData<Candidate>(detailKey, (candidate) => candidate && decided(candidate, input, userId));
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

export type ExportChoice = "all" | Decision;
export const EXPORT_FAILED = "We couldn't export the candidates. Try again.";

// Downloads the job's candidates as a CSV. The API needs the session token, so the file is fetched and handed to the
// browser as a temporary link instead of being opened by a plain link.
export function useExportCsv(jobId: string) {
	const { token } = useSession();
	return useMutation({
		mutationFn: async (choice: ExportChoice) => {
			const { blob, fileName } = await apiGetFile(`/jobs/${jobId}/candidates/export.csv?decision=${choice}`, {
				token: await token(),
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName ?? "applicants.csv";
			document.body.append(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), CV_URL_REVOKE_MS);
		},
	});
}

export type UploadItem = {
	key: number;
	fileName: string;
	// "staged" is chosen but not sent yet: its name and email can still be typed.
	state: "staged" | "waiting" | "uploading" | "done" | "failed";
	// What the recruiter typed for this CV; blank means "read it from the CV".
	name: string;
	email: string;
	// Why the typed details stop the batch, shown on the row.
	detailError?: string;
	// How much of the file has gone up, 0 to 100, while it uploads.
	progress?: number;
	// Why a file wasn't uploaded, in words the recruiter can act on.
	error?: string;
	// True when trying again could work: the connection dropped or our side failed. A refused file won't change.
	canRetry?: boolean;
};

// The longest name the API takes (apps/api/src/candidates.ts).
export const APPLICANT_NAME_MAX = 120;
// The API's own test for an address (apps/api/src/public.ts): loose on purpose.
// The API's rule: plain ASCII addresses only. Anything else is either not one address or can't travel in a request
// header, and in a mailto: link it could add a recipient or a query.
const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
export const isEmail = (raw: string) => raw.length <= 254 && EMAIL_PATTERN.test(raw);

// What is wrong with the details typed for the staged files, by item key: an address that isn't one, or one that two
// files share (the later file is marked). A blank address is fine.
export function checkDetails(items: Pick<UploadItem, "key" | "state" | "email">[]): Map<number, string> {
	const problems = new Map<number, string>();
	const seen = new Set<string>();
	for (const { key, state, email } of items) {
		const address = email.trim().toLowerCase();
		if (state !== "staged" || !address) continue;
		if (!isEmail(address)) problems.set(key, "Enter a valid email address");
		else if (seen.has(address)) problems.set(key, "Another file in this batch has this email address");
		else seen.add(address);
	}
	return problems;
}

// Whether an upload failure is worth another go.
const isTransient = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500;

// How many files go up at the same time.
export const UPLOAD_PARALLEL = 3;

// Chosen PDFs wait as "staged" rows, where an optional name and email can be typed for each; `upload` then sends them
// UPLOAD_PARALLEL at a time and reports each file's state and progress. A file that fails the client checks or the API
// doesn't stop the others. A staged or waiting file can be taken out before its turn, and one that failed to upload
// (not one that was refused) can be sent again.
export function useUploadCvs(jobId: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const [items, setItems] = useState<UploadItem[]>([]);
	const nextKey = useRef(0);
	// The files of the current list by item key, the details sent with them, and the keys still to upload, in order.
	const files = useRef(new Map<number, File>());
	const details = useRef(new Map<number, { name: string; email: string }>());
	const queue = useRef<number[]>([]);
	const active = useRef(0);
	// Once the API says the job can't take more CVs, the rest of the queue is not sent.
	const refusal = useRef<string | null>(null);

	const patch = (key: number, change: Partial<UploadItem>) =>
		setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

	const busy = () => active.current > 0 || queue.current.length > 0;

	const send = async (key: number, file: File) => {
		const listQueryKey = listKey(userId, jobId);
		patch(key, { state: "uploading", progress: 0, error: undefined, canRetry: undefined });
		const { name, email } = details.current.get(key) ?? { name: "", email: "" };
		const headers: Record<string, string> = {};
		if (name) headers["X-Applicant-Name"] = encodeURIComponent(name);
		if (email) headers["X-Applicant-Email"] = email;
		try {
			const { candidate } = await apiUploadPdf<{ candidate: Candidate }>(
				`/jobs/${jobId}/candidates?fileName=${encodeURIComponent(file.name)}`,
				file,
				{ token: await token(), headers, onProgress: (progress) => patch(key, { progress }) },
			);
			// Show it in the list at once; the refetch at the end brings the server's order and counts. A list
			// fetch still in flight would land after this and wipe the new row, so stop it first.
			await queryClient.cancelQueries({ queryKey: listQueryKey, exact: true });
			queryClient.setQueryData<CandidateList>(
				listQueryKey,
				(list) => list && { ...list, candidates: withQueued(list, candidate), cvCount: list.cvCount + 1 },
			);
			files.current.delete(key);
			patch(key, { state: "done", progress: 100 });
		} catch (error) {
			if (error instanceof ApiError && (error.code === "cv_limit" || error.code === "job_not_open")) {
				refusal.current = error.message;
			}
			patch(key, {
				state: "failed",
				error: error instanceof ApiError ? error.message : "We couldn't upload that file. Try again.",
				canRetry: isTransient(error),
			});
		}
	};

	// Starts files from the queue until UPLOAD_PARALLEL are going; each one that ends starts the next. A key added
	// meanwhile (a retry) is picked up the same way.
	const pump = () => {
		while (active.current < UPLOAD_PARALLEL) {
			const next = queue.current.shift();
			if (next === undefined) break;
			const file = files.current.get(next);
			// Removed while it waited.
			if (!file) continue;
			if (refusal.current) {
				patch(next, { state: "failed", error: refusal.current, canRetry: false });
				continue;
			}
			active.current += 1;
			void send(next, file).finally(() => {
				active.current -= 1;
				pump();
			});
		}
		if (busy()) return;
		void queryClient.invalidateQueries({ queryKey: listKey(userId, jobId), exact: true });
		// The job's own CV count, and its status if the API found it closed.
		void queryClient.invalidateQueries({ queryKey: jobKey(userId, jobId), exact: true });
		// The CVs being read now show in the jobs lists and the overview, which then poll until they are read.
		invalidateAround(queryClient, userId);
	};

	// Checks the chosen files. With `withDetails` the ones that pass are staged, for a name and email to be typed;
	// otherwise they are queued at once. Staged files from an earlier choice stay either way; the results of the last
	// upload are replaced.
	const choose = (
		chosen: File[],
		slotsLeft: number,
		limit: number = CV_LIMIT_PER_JOB,
		withDetails = false,
	) => {
		if (busy() || chosen.length === 0) return;
		const staged = items.filter(({ state }) => state === "staged");
		for (const { key } of items) if (!staged.some((item) => item.key === key)) files.current.delete(key);
		refusal.current = null;

		let free = slotsLeft - staged.filter(({ key }) => files.current.has(key)).length;
		const added = chosen.map((file) => {
			const error = checkCv(file, free, limit);
			if (!error) free -= 1;
			const item: UploadItem = {
				key: nextKey.current++,
				fileName: file.name,
				state: error ? "failed" : withDetails ? "staged" : "waiting",
				name: "",
				email: "",
				error: error ?? undefined,
			};
			if (!error) {
				files.current.set(item.key, file);
				if (!withDetails) {
					details.current.set(item.key, { name: "", email: "" });
					queue.current.push(item.key);
				}
			}
			return item;
		});
		setItems([...staged, ...added]);
		if (!withDetails) pump();
	};

	// Types into a staged file's name or email.
	const edit = (key: number, change: Partial<Pick<UploadItem, "name" | "email">>) =>
		patch(key, { ...change, detailError: undefined });

	// Sends the staged files, unless the details typed for them stop the batch.
	const upload = () => {
		const staged = items.filter(({ state }) => state === "staged");
		if (busy() || staged.length === 0) return;
		const problems = checkDetails(staged);
		if (problems.size > 0) {
			setItems((list) => list.map((item) => ({ ...item, detailError: problems.get(item.key) })));
			return;
		}
		refusal.current = null;
		for (const { key, name, email } of staged) {
			details.current.set(key, { name: name.trim(), email: email.trim() });
			queue.current.push(key);
		}
		setItems((list) =>
			list.map((item) => (item.state === "staged" ? { ...item, state: "waiting", detailError: undefined } : item)),
		);
		pump();
	};

	// Takes a file that hasn't started uploading out of the batch.
	const remove = (key: number) => {
		const staged = items.some((item) => item.key === key && item.state === "staged");
		if (!staged && !queue.current.includes(key)) return;
		queue.current = queue.current.filter((queued) => queued !== key);
		files.current.delete(key);
		details.current.delete(key);
		setItems((list) => list.filter((item) => item.key !== key));
	};

	// Sends a file again that failed to upload, behind whatever is still going up.
	const retry = (key: number) => {
		if (!files.current.has(key) || queue.current.includes(key)) return;
		refusal.current = null;
		queue.current.push(key);
		patch(key, { state: "waiting", error: undefined, canRetry: undefined });
		pump();
	};

	const clear = () => {
		files.current.clear();
		details.current.clear();
		queue.current = [];
		setItems([]);
	};

	return { items, choose, edit, upload, remove, retry, clear };
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
		// Also after a refusal: what the recruiter clicked in was out of date. The failed CV is being read again, so
		// the counts elsewhere move too.
		onSettled: (_candidate, _error, id) => {
			void queryClient.invalidateQueries({ queryKey: listKey(userId, jobId), exact: true });
			void queryClient.invalidateQueries({ queryKey: candidateKey(userId, jobId, id), exact: true });
			invalidateAround(queryClient, userId);
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
			invalidateAround(queryClient, userId);
			forgetVisit("candidate", id);
		},
	});
}

// The most CVs one bulk action takes (apps/api/src/candidates.ts).
export const BULK_MAX = 200;
export type BulkDecideInput = { ids: string[]; decision: Decision };
// A CV whose decision a bulk action changed, and what it was before.
export type BulkDecided = { id: string; jobId: string; decision: Decision; previous: Decision };
export type BulkDeleted = { id: string; jobId: string };

// What an undo sends: one bulk decision per earlier decision, with the CVs that had it.
export function undoBatches(updated: BulkDecided[]): BulkDecideInput[] {
	const byDecision = new Map<Decision, string[]>();
	for (const { id, previous } of updated) byDecision.set(previous, [...(byDecision.get(previous) ?? []), id]);
	return [...byDecision].map(([decision, ids]) => ({ ids, decision }));
}

const isCandidateList = (data: unknown): data is CandidateList =>
	typeof data === "object" && data !== null && Array.isArray((data as CandidateList).candidates);
const isCandidate = (data: unknown): data is Candidate =>
	typeof data === "object" && data !== null && typeof (data as Candidate).id === "string" && "rankedCount" in data;

// What the CVs a bulk decision changed showed before it, by id: the decision, and when and by whom it was made for a
// candidate's own query. A refusal puts back only these.
type BulkBefore = { decision: Map<string, Decision>; decided: Map<string, Pick<Candidate, "decidedAt" | "decidedBy">> };

// One decision for many CVs, across jobs. Every cached job list, candidate and candidates page shows it at once and
// gets its old state back if the API refuses; afterwards everything that counts decisions asks again. The answer is
// what changed, with the old decisions, which `undoBatches` turns into the undo.
export function useBulkDecide() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const mutationKey = ["bulk-decide", userId];
	const candidatesPrefix = ["candidates", userId] as const;
	return useMutation({
		mutationKey,
		mutationFn: async ({ ids, decision }: BulkDecideInput) =>
			(await apiPost<{ updated: BulkDecided[] }>("/candidates/decisions", { ids, decision }, { token: await token() }))
				.updated,
		onMutate: async ({ ids, decision }): Promise<BulkBefore> => {
			const chosen = new Set(ids);
			// A fetch already on its way would land after this and show the old decisions.
			await Promise.all([
				queryClient.cancelQueries({ queryKey: candidatesPrefix }),
				queryClient.cancelQueries({ queryKey: allCandidatesKey(userId) }),
			]);
			const before: BulkBefore = { decision: new Map(), decided: new Map() };
			const change = <T extends { id: string; decision: Decision }>(rows: T[]) =>
				rows.map((row) => {
					if (!chosen.has(row.id)) return row;
					if (!before.decision.has(row.id)) before.decision.set(row.id, row.decision);
					return { ...row, decision };
				});
			queryClient.setQueriesData<unknown>({ queryKey: candidatesPrefix }, (data: unknown) => {
				if (isCandidateList(data)) return { ...data, candidates: change(data.candidates) };
				if (!isCandidate(data) || !chosen.has(data.id)) return data;
				before.decision.set(data.id, data.decision);
				before.decided.set(data.id, { decidedAt: data.decidedAt, decidedBy: data.decidedBy });
				return decided(data, { decision }, userId);
			});
			queryClient.setQueriesData<AllCandidatesList>(
				{ queryKey: allCandidatesKey(userId) },
				(list) => list && { ...list, candidates: change(list.candidates) },
			);
			return before;
		},
		// Puts back only the CVs this action changed, and only where they still show its decision, so another action
		// started meanwhile keeps what it shows.
		onError: (_error, { decision }, before) => {
			if (!before) return;
			const restore = <T extends { id: string; decision: Decision }>(rows: T[]) =>
				rows.map((row) => {
					const was = before.decision.get(row.id);
					return was === undefined || row.decision !== decision ? row : { ...row, decision: was };
				});
			queryClient.setQueriesData<unknown>({ queryKey: candidatesPrefix }, (data: unknown) => {
				if (isCandidateList(data)) return { ...data, candidates: restore(data.candidates) };
				const was = isCandidate(data) ? before.decision.get(data.id) : undefined;
				if (!isCandidate(data) || was === undefined || data.decision !== decision) return data;
				return { ...data, decision: was, ...before.decided.get(data.id) };
			});
			queryClient.setQueriesData<AllCandidatesList>(
				{ queryKey: allCandidatesKey(userId) },
				(list) => list && { ...list, candidates: restore(list.candidates) },
			);
		},
		// Also after a refusal: the pages then show what the API holds. While another bulk decision is on its way, only
		// the last one asks, or the lists would flick back to decisions that are about to change.
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey }) > 1) return;
			void queryClient.invalidateQueries({ queryKey: candidatesPrefix });
			invalidateAround(queryClient, userId);
		},
	});
}

// Deletes many CVs and their files (admins only). They leave every cached list as soon as the API confirms; a deleted
// candidate's own query is only marked stale, like a single delete, so an open panel doesn't flash "doesn't exist"
// before the page moves on. The jobs keep their CV counts: a deleted CV doesn't give its slot back.
export function useBulkDelete() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	const isJobList = (queryKey: QueryKey) => queryKey[0] === "candidates" && queryKey[1] === userId && queryKey.length === 3;
	return useMutation({
		mutationFn: async (ids: string[]) =>
			(await apiPost<{ deleted: BulkDeleted[] }>("/candidates/delete", { ids }, { token: await token() })).deleted,
		onSuccess: (deleted) => {
			const gone = new Set(deleted.map(({ id }) => id));
			queryClient.setQueriesData<unknown>({ predicate: ({ queryKey }) => isJobList(queryKey) }, (data: unknown) =>
				isCandidateList(data) ? { ...data, candidates: data.candidates.filter(({ id }) => !gone.has(id)) } : data,
			);
			queryClient.setQueriesData<AllCandidatesList>(
				{ queryKey: allCandidatesKey(userId) },
				(list) => list && { ...list, candidates: list.candidates.filter(({ id }) => !gone.has(id)) },
			);
			for (const { id, jobId } of deleted) {
				void queryClient.cancelQueries({ queryKey: candidateKey(userId, jobId, id), exact: true });
				void queryClient.invalidateQueries({ queryKey: candidateKey(userId, jobId, id), exact: true, refetchType: "none" });
				forgetVisit("candidate", id);
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ predicate: ({ queryKey }) => isJobList(queryKey) });
			invalidateAround(queryClient, userId);
		},
	});
}
