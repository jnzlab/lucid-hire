import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { allCandidatesKey } from "./all-candidates.ts";
import { apiDelete, apiDeleteJson, apiGet, apiGetBlob, apiPatch, apiPost, apiPutFile } from "./api.ts";
import { billingKey } from "./billing.ts";
import { overviewKey } from "./overview.ts";
import { forgetJobVisits } from "./recent.ts";
import { searchKey } from "./search.ts";
import { useSession } from "./session.ts";

export type JobStatus = "draft" | "open" | "closed";
// `cvCount` is the CVs ever uploaded to the job. Deleting a candidate doesn't lower it.
export type JobSummary = {
	id: string;
	// The public page is /jobs/<slug>.
	slug: string;
	title: string;
	status: JobStatus;
	cvCount: number;
	hasCover: boolean;
	createdAt: string;
	updatedAt: string;
};
// A row of the jobs list: its pipeline, its best scored CV and when its latest CV came in. The counts mean what they
// mean everywhere: to review = scored and undecided, reading = queued or being scored; shortlisted and not a fit
// (`rejected`) go by the decision alone, failed by the status alone, so a failed CV someone rejected is in both.
export type JobListItem = JobSummary & {
	scoredCount: number;
	toReviewCount: number;
	shortlistedCount: number;
	rejectedCount: number;
	readingCount: number;
	failedCount: number;
	// The best scored CV by the job's ranking, and its score; null while nothing is scored.
	topScore: number | null;
	topCandidate: { id: string; name: string | null } | null;
	// When the latest CV was uploaded (ISO), or null for a job without CVs.
	lastCvAt: string | null;
};
// How many of the company's jobs match the search, per status, whatever the status filter.
export type JobCounts = { all: number; open: number; draft: number; closed: number };
export type JobList = { jobs: JobListItem[]; total: number; page: number; pageSize: number; counts: JobCounts };
export type Job = JobSummary & { description: string };

export const JOB_SEARCH_MAX = 100;
// Every sort the API takes. `activity` is the latest CV first (jobs without CVs last), `review` the most CVs to
// review first; newest breaks ties for both.
export const JOB_SORTS = ["newest", "oldest", "title", "candidates", "activity", "review"] as const;
export type JobSort = (typeof JOB_SORTS)[number];
export const SORT_LABEL: Record<JobSort, string> = {
	newest: "Newest",
	oldest: "Oldest",
	title: "Title A–Z",
	candidates: "Most candidates",
	activity: "Recent activity",
	review: "Most to review",
};
// The sorts the jobs list offers, in menu order. "Most candidates" still works in a link but isn't offered.
export const JOB_SORT_MENU: readonly JobSort[] = ["newest", "activity", "review", "title", "oldest"];
// What the jobs list is showing. This is the page's URL search too, so a default is simply left out of it.
export type JobFilters = { q?: string; status?: JobStatus; sort?: Exclude<JobSort, "newest">; page?: number };
export type JobInput = { title: string; description: string };

// The same bounds and clean-up the API applies (apps/api/src/jobs.ts).
export const JOB_TITLE_MIN = 2;
export const JOB_TITLE_MAX = 120;
export const JOB_DESCRIPTION_MAX = 20_000;
export const JOB_TITLE_HINT = `Enter a job title between ${JOB_TITLE_MIN} and ${JOB_TITLE_MAX} characters`;

export const STATUS_LABEL: Record<JobStatus, string> = { draft: "Draft", open: "Open", closed: "Closed" };

// Keyed by user, so a different account in the same tab never sees another company's cached jobs. `jobsKey` is
// every cached list (one per filter); a single job is under `jobKey`.
export const jobsKey = (userId: Nullable) => ["jobs", userId, "list"] as const;
export const jobKey = (userId: Nullable, id: string) => ["jobs", userId, id] as const;
type Nullable = string | null | undefined;

export function jobsPath({ q, status, sort, page }: JobFilters) {
	const params = new URLSearchParams();
	if (q) params.set("q", q);
	if (status) params.set("status", status);
	if (sort) params.set("sort", sort);
	if (page && page > 1) params.set("page", String(page));
	const query = params.toString();
	return query ? `/jobs?${query}` : "/jobs";
}

// With `pollMs`, the list asks again that often while one of its jobs has CVs being read, so their counts catch up.
export function useJobs(filters: JobFilters = {}, { enabled = true, pollMs }: { enabled?: boolean; pollMs?: number } = {}) {
	const { userId, token } = useSession();
	const path = jobsPath(filters);
	return useQuery({
		queryKey: [...jobsKey(userId), path] as const,
		queryFn: async ({ signal }) => apiGet<JobList>(path, { token: await token(), signal }),
		enabled,
		// While the next filter loads, the list on screen stays, so typing in the search box doesn't flash.
		placeholderData: keepPreviousData,
		refetchInterval: ({ state }) => (pollMs && state.data?.jobs.some((job) => job.readingCount > 0) ? pollMs : false),
	});
}

export function useJob(id: string) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: jobKey(userId, id),
		queryFn: async ({ signal }) => (await apiGet<{ job: Job }>(`/jobs/${id}`, { token: await token(), signal })).job,
		retry: (failures, error) => failures < 1 && !("status" in error && error.status === 404),
	});
}

// Saves a job and primes its page, so opening it after saving needs no request.
function useSaveJob<V>(
	save: (variables: V, token: string | null) => Promise<{ job: Job }>,
	{ spendsAllowance = false }: { spendsAllowance?: boolean } = {},
) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (variables: V) => (await save(variables, await token())).job,
		onSuccess: (job) => {
			queryClient.setQueryData(jobKey(userId, job.id), job);
			void queryClient.invalidateQueries({ queryKey: jobsKey(userId) });
			// The overview's work queue lists open jobs and drafts by name.
			void queryClient.invalidateQueries({ queryKey: overviewKey(userId) });
		},
		// A new job spends one of the month's allowance, and a refused one means the page's count was out of date.
		onSettled: () => {
			if (spendsAllowance) void queryClient.invalidateQueries({ queryKey: billingKey(userId) });
		},
	});
}

export function useCreateJob() {
	return useSaveJob(
		(input: JobInput & { status: "draft" | "open" }, token) => apiPost<{ job: Job }>("/jobs", input, { token }),
		{ spendsAllowance: true },
	);
}

export function useUpdateJob(id: string) {
	return useSaveJob((patch: Partial<JobInput> & { status?: JobStatus }, token) =>
		apiPatch<{ job: Job }>(`/jobs/${id}`, patch, { token }),
	);
}

// Saves a copy of the job as a new draft.
export function useDuplicateJob(id: string) {
	return useSaveJob((_: void, token) => apiPost<{ job: Job }>(`/jobs/${id}/duplicate`, undefined, { token }));
}

export function useDeleteJob(id: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => apiDelete(`/jobs/${id}`, { token: await token() }),
		onSuccess: () => {
			// Drop it from the cached lists that show it, with their totals and status counts, or the row and the
			// tabs stay one too high until the refetch lands. Lists that don't show it wait for the refetch.
			queryClient.setQueriesData<JobList>({ queryKey: jobsKey(userId) }, (list) => {
				const gone = list?.jobs.find((job) => job.id === id);
				if (!list || !gone) return list;
				const counts = list.counts && {
					...list.counts,
					all: Math.max(0, list.counts.all - 1),
					[gone.status]: Math.max(0, list.counts[gone.status] - 1),
				};
				return { ...list, jobs: list.jobs.filter((job) => job.id !== id), total: Math.max(0, list.total - 1), counts };
			});
			queryClient.removeQueries({ queryKey: jobKey(userId, id), exact: true });
			forgetJobVisits(id);
			// Its candidates went with it: out of the overview's counts, the candidates page and the palette's search.
			for (const queryKey of [jobsKey(userId), overviewKey(userId), allCandidatesKey(userId), searchKey(userId)]) {
				void queryClient.invalidateQueries({ queryKey });
			}
		},
	});
}

// Rewrites rough notes with AI. Nothing is saved until the recruiter saves the form.
export function useEnhanceDescription() {
	const { token } = useSession();
	return useMutation({
		mutationFn: async (input: { title?: string; description: string }) =>
			(await apiPost<{ description: string }>("/jobs/enhance", input, { token: await token() })).description,
	});
}

export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];

// The same checks the API makes, in the same words.
export function checkCover(file: File): string | null {
	if (!COVER_TYPES.includes(file.type)) return "Upload a JPEG, PNG or WebP image";
	if (file.size === 0) return "That file is empty";
	if (file.size > COVER_MAX_BYTES) return "The cover image must be 2 MB or smaller";
	return null;
}

// The job's own cover, fetched with the session so it works for drafts too. `version` changes with every save.
export function useCoverImage(id: string, hasCover: boolean, version: string) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: ["job-cover", userId, id, version],
		enabled: hasCover,
		queryFn: async ({ signal }) => URL.createObjectURL(await apiGetBlob(`/jobs/${id}/cover`, { token: await token(), signal })),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 60_000,
	});
}

export function useSetCover(id: string) {
	return useSaveJob((file: File, token) => apiPutFile<{ job: Job }>(`/jobs/${id}/cover`, file, { token }));
}

export function useRemoveCover(id: string) {
	return useSaveJob((_: void, token) => apiDeleteJson<{ job: Job }>(`/jobs/${id}/cover`, { token }));
}

// Where "Upload CVs" goes: the newest open job, else the newest job, else the new-job page.
export function useUploadTarget(): { jobId: string | null } {
	const open = useJobs({ status: "open" });
	const noneOpen = open.isSuccess && open.data.jobs.length === 0;
	const newest = useJobs({}, { enabled: noneOpen });
	const target = open.data?.jobs[0] ?? (noneOpen ? newest.data?.jobs[0] : undefined);
	return { jobId: target?.id ?? null };
}
