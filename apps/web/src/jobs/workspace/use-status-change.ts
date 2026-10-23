import { type Job, type JobStatus, useUpdateJob } from "../../lib/jobs.ts";
import { useToast } from "../../ui/use-toast.ts";

// What the status control does next, what the toast says once it has, and what the current status means.
export const NEXT_STATUS: Record<JobStatus, { to: JobStatus; label: string; done: string; now: string; effect: string }> = {
	draft: {
		to: "open",
		label: "Open job",
		done: "Job opened",
		now: "Draft: only your team can see it",
		effect: "Takes CVs and puts the apply page live.",
	},
	open: {
		to: "closed",
		label: "Close job",
		done: "Job closed",
		now: "Open: taking CVs",
		effect: "Stops new CVs. The apply page says the role is closed.",
	},
	closed: {
		to: "open",
		label: "Reopen job",
		done: "Job reopened",
		now: "Closed: not taking CVs",
		effect: "Takes CVs again on the same apply link.",
	},
};

// Opens, closes or reopens the job, from the status menu, the banner above the list or the upload drawer. It runs once
// at a time (a second click while it saves is ignored), and the toast says what happened.
export function useStatusChange(job: Job) {
	const update = useUpdateJob(job.id);
	const toast = useToast();
	const next = NEXT_STATUS[job.status];
	const change = () => {
		if (update.isPending) return;
		update.mutate(
			{ status: next.to },
			{
				onSuccess: () => toast.show(next.done),
				onError: (error) => toast.error(error.message),
			},
		);
	};
	return { next, change, pending: update.isPending };
}

export type StatusChange = ReturnType<typeof useStatusChange>;
