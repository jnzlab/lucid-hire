import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";
import { useSession } from "./session.ts";

export type JobStatus = "draft" | "open" | "closed";
// `cvCount` is the CVs ever uploaded to the job. Deleting a candidate doesn't lower it.
export type JobSummary = {
	id: string;
	title: string;
	status: JobStatus;
	cvCount: number;
	createdAt: string;
	updatedAt: string;
};
export type Job = JobSummary & { description: string };
export type JobInput = { title: string; description: string };

// The same bounds and clean-up the API applies (apps/api/src/jobs.ts).
export const JOB_TITLE_MIN = 2;
export const JOB_TITLE_MAX = 120;
export const JOB_DESCRIPTION_MAX = 20_000;
export const JOB_TITLE_HINT = `Enter a job title between ${JOB_TITLE_MIN} and ${JOB_TITLE_MAX} characters`;

export const STATUS_LABEL: Record<JobStatus, string> = { draft: "Draft", open: "Open", closed: "Closed" };

// Keyed by user, so a different account in the same tab never sees another company's cached jobs.
export const jobsKey = (userId: Nullable) => ["jobs", userId] as const;
export const jobKey = (userId: Nullable, id: string) => ["jobs", userId, id] as const;
type Nullable = string | null | undefined;

export function useJobs() {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: jobsKey(userId),
		queryFn: async ({ signal }) => (await apiGet<{ jobs: JobSummary[] }>("/jobs", { token: await token(), signal })).jobs,
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
function useSaveJob<V>(save: (variables: V, token: string | null) => Promise<{ job: Job }>) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (variables: V) => (await save(variables, await token())).job,
		onSuccess: (job) => {
			queryClient.setQueryData(jobKey(userId, job.id), job);
			void queryClient.invalidateQueries({ queryKey: jobsKey(userId), exact: true });
		},
	});
}

export function useCreateJob() {
	return useSaveJob((input: JobInput & { status: "draft" | "open" }, token) =>
		apiPost<{ job: Job }>("/jobs", input, { token }),
	);
}

export function useUpdateJob(id: string) {
	return useSaveJob((patch: Partial<JobInput> & { status?: JobStatus }, token) =>
		apiPatch<{ job: Job }>(`/jobs/${id}`, patch, { token }),
	);
}

export function useDeleteJob(id: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => apiDelete(`/jobs/${id}`, { token: await token() }),
		onSuccess: () => {
			// Drop it from the cached list too, or the list shows it until the refetch lands.
			queryClient.setQueryData<JobSummary[]>(jobsKey(userId), (list) => list?.filter((job) => job.id !== id));
			queryClient.removeQueries({ queryKey: jobKey(userId, id), exact: true });
			void queryClient.invalidateQueries({ queryKey: jobsKey(userId), exact: true });
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

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(iso: string) {
	return DATE_FORMAT.format(new Date(iso));
}
