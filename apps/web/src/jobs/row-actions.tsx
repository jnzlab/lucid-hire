import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, CircleStop, Copy, Ellipsis, Eye, Link2, Pencil, Play, Share2, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type JobListItem, type JobStatus, useDeleteJob, useDuplicateJob, useUpdateJob } from "../lib/jobs.ts";
import { publicJobUrl } from "../lib/public-jobs.ts";
import { buildShareLinks, shareTargets } from "../lib/share.ts";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu.tsx";
import { useToast } from "../ui/use-toast.ts";
import { cvsOnJob } from "./list/summaries.ts";

const ICON = { size: 16, "aria-hidden": true } as const;

// The one status change each status offers, what it does in a line, and the verb its toast uses.
const STATUS_CHANGE: Record<JobStatus, { to: JobStatus; label: string; description: string; done: string; icon: ReactNode }> = {
	open: {
		to: "closed",
		label: "Close job",
		description: "Stops new CVs. The apply page says it's closed.",
		done: "Closed",
		icon: <CircleStop {...ICON} />,
	},
	closed: { to: "open", label: "Reopen job", description: "Takes CVs again on the apply page.", done: "Reopened", icon: <Play {...ICON} /> },
	draft: { to: "open", label: "Open job", description: "Puts the apply page live so it takes CVs.", done: "Opened", icon: <Play {...ICON} /> },
};

// The "…" menu on a job row: view, edit, duplicate, the apply link and sharing (as on the job's page: a draft has no
// public page, a closed job has one but isn't worth sharing), the status change, and Delete for admins. Copies,
// status changes and deletes are confirmed in a toast; a status change can be undone from it.
export function RowActions({ job, onDeleted }: { job: JobListItem; onDeleted: (job: JobListItem) => void }) {
	const org = useOrg();
	const navigate = useNavigate();
	const toast = useToast();
	const duplicate = useDuplicateJob(job.id);
	const update = useUpdateJob(job.id);
	const remove = useDeleteJob(job.id);
	const [confirming, setConfirming] = useState(false);
	const [sharing, setSharing] = useState(false);

	const copy = async (text: string, done: string, what: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.show(done);
		} catch {
			toast.error(
				<>
					Couldn't <span className="mk mk-gap">copy</span> the {what}. Open the job and copy it from Share.
				</>,
			);
		}
	};

	const duplicateJob = () =>
		duplicate.mutate(undefined, {
			onSuccess: (created) =>
				void navigate({ to: "/dashboard/jobs/$jobId/edit", params: { jobId: created.id }, state: { duplicatedJob: true } }),
			// The API's own words: a plan limit says which limit, without generic upgrade wording.
			onError: (error) => toast.error(error.message),
		});

	// mutateAsync rather than callbacks: a status filter can take the row off the list before the answer comes back,
	// and the toast (with its Undo) must still appear.
	const setStatus = async (to: JobStatus, from: JobStatus, undo = false) => {
		try {
			await update.mutateAsync({ status: to });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
			return;
		}
		if (undo) return;
		toast.show({
			message: `${STATUS_CHANGE[from].done} “${job.title}”`,
			action: { label: "Undo", onClick: () => void setStatus(from, to, true) },
		});
	};

	// The list doesn't carry descriptions, so a caption from here is the title and the link.
	const targets = shareTargets(buildShareLinks({ title: job.title, description: "", slug: job.slug }));
	const change = STATUS_CHANGE[job.status];
	const cvs = cvsOnJob(job);
	const removed = cvs > 0 ? `It and its ${cvs} ${cvs === 1 ? "CV are" : "CVs are"} removed` : "It's removed";

	return (
		<>
			<Menu
				align="end"
				onOpenChange={(open) => {
					if (!open) setSharing(false);
				}}
				trigger={(props) => (
					<button {...props} aria-label={`Actions for ${job.title}`} className="icon-btn relative z-10">
						<Ellipsis size={20} aria-hidden="true" />
					</button>
				)}
			>
				<MenuItem href={`/dashboard/jobs/${job.id}`} icon={<Eye {...ICON} />}>
					View job
				</MenuItem>
				<MenuItem href={`/dashboard/jobs/${job.id}/edit`} icon={<Pencil {...ICON} />}>
					Edit job
				</MenuItem>
				<MenuItem onSelect={duplicateJob} icon={<Copy {...ICON} />} disabled={duplicate.isPending}>
					Duplicate
				</MenuItem>
				{job.status !== "draft" && (
					<>
						<MenuSeparator />
						<MenuItem
							icon={<Link2 {...ICON} />}
							onSelect={() => void copy(publicJobUrl(job.slug), "Apply link copied", "link")}
						>
							Copy apply link
						</MenuItem>
					</>
				)}
				{job.status === "open" && (
					<>
						{/* Opens the share targets in place, under it, so the menu stays one level deep. */}
						<button
							type="button"
							role="menuitem"
							tabIndex={-1}
							aria-expanded={sharing}
							className="menu-item"
							onClick={() => setSharing(!sharing)}
						>
							<span className="grid size-4 flex-none place-items-center">
								<Share2 {...ICON} />
							</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate">Share</span>
							</span>
							<ChevronDown
								size={16}
								aria-hidden="true"
								className={`flex-none text-ink-muted transition-transform ${sharing ? "rotate-180" : ""}`}
							/>
						</button>
						{sharing && (
							<div role="group" aria-label="Share this job" className="ml-[17px] border-l border-line pl-1.5">
								{targets.map((target) =>
									"caption" in target ? (
										<MenuItem key={target.label} onSelect={() => void copy(target.caption, "Caption copied", "caption")}>
											{target.label}
										</MenuItem>
									) : (
										<MenuItem key={target.label} href={target.href} target={target.external ? "_blank" : undefined}>
											{target.label}
										</MenuItem>
									),
								)}
							</div>
						)}
					</>
				)}
				<MenuSeparator />
				<MenuItem
					icon={change.icon}
					description={change.description}
					disabled={update.isPending}
					onSelect={() => void setStatus(change.to, job.status)}
				>
					{change.label}
				</MenuItem>
				{org.role === "admin" && (
					<>
						<MenuSeparator />
						{/* The menu closes first and gives focus to its button, so the dialog hands focus back to it. */}
						<MenuItem destructive icon={<Trash2 {...ICON} />} onSelect={() => setConfirming(true)}>
							Delete job
						</MenuItem>
					</>
				)}
			</Menu>
			{duplicate.isPending && (
				<p role="status" className="sr-only">
					Duplicating
				</p>
			)}
			{confirming && (
				<ConfirmDialog
					heading={`Delete “${job.title}”?`}
					confirmLabel="Delete job"
					busyLabel="Deleting"
					busy={remove.isPending}
					error={remove.isError ? remove.error.message : null}
					onCancel={() => {
						remove.reset();
						setConfirming(false);
					}}
					onConfirm={() => {
						// The row leaves the list as soon as the cache drops it, so the page (not this row) says it's gone.
						remove.mutateAsync().then(
							() => {
								setConfirming(false);
								onDeleted(job);
							},
							() => {},
						);
					}}
				>
					{removed} for everyone at {org.name}. You can't undo this.
				</ConfirmDialog>
			)}
		</>
	);
}
