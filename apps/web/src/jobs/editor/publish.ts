import type { JobStatus } from "../../lib/jobs.ts";

export type EditorMode = "new" | "edit";
export type StatusChoice = { value: JobStatus; label: string; description: string };

const CHOICES: Record<JobStatus, StatusChoice> = {
	open: { value: "open", label: "Open", description: "Takes CVs now and the apply page is live." },
	draft: { value: "draft", label: "Draft", description: "Only your team can see it." },
	closed: { value: "closed", label: "Closed", description: "Takes no new CVs. The apply page says it's closed." },
};

// The statuses the Publish card offers. A new job opens now or waits as a draft; a saved one moves the way the job
// page's status menu moves it: a draft can open, an open job can close and a closed one can reopen. Nothing goes
// back to being a draft once candidates may have seen it.
export function statusChoices(mode: EditorMode, current: JobStatus = "draft"): StatusChoice[] {
	if (mode === "new" || current === "draft") return [CHOICES.open, CHOICES.draft];
	return [CHOICES.open, CHOICES.closed];
}

// The primary button follows the choice on a new job ("Open job" / "Save draft"); an edit always saves changes.
export function submitLabel(mode: EditorMode, status: JobStatus, saving = false): string {
	if (saving) return "Saving";
	if (mode === "edit") return "Save changes";
	return status === "open" ? "Open job" : "Save draft";
}

// What the toast says once the job is saved, so the job page it lands on doesn't have to.
export function savedMessage(mode: EditorMode, status: JobStatus, previous?: JobStatus): string {
	if (mode === "new") return status === "open" ? "Job opened. The apply page is live." : "Draft saved. Only your team can see it.";
	if (status === previous) return "Changes saved";
	if (status === "closed") return "Saved and closed. It takes no new CVs.";
	return previous === "closed" ? "Saved and reopened. It takes CVs again." : "Saved and opened. The apply page is live.";
}
