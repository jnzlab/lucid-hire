import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, CopyPlus, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ExportItems } from "../../candidates/export-menu.tsx";
import { Check } from "../../components/icons.tsx";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { useOrg } from "../../dashboard/org.ts";
import { type CandidateSummary, EXPORT_FAILED, type ExportChoice, isWorking, useExportCsv } from "../../lib/candidates.ts";
import { formatDate } from "../../lib/format.ts";
import { type Job, type JobStatus, STATUS_LABEL, useDeleteJob, useDuplicateJob } from "../../lib/jobs.ts";
import { forgetVisit } from "../../lib/recent.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { Menu, MenuGroup, MenuItem, MenuSeparator } from "../../ui/menu.tsx";
import { PageHeader } from "../../ui/page-header.tsx";
import { useToast } from "../../ui/use-toast.ts";
import { ShareButton } from "../share-panel.tsx";
import type { Capacity } from "./capacity.ts";
import type { StatusChange } from "./use-status-change.ts";

declare module "@tanstack/react-router" {
	interface HistoryState {
		// Read by the jobs list after a delete from here, for its confirmation.
		deletedJob?: string;
		// Read by the edit page after Duplicate, for its "Duplicated as a draft" notice.
		duplicatedJob?: boolean;
	}
}

// The status dot, as StatusTag draws it: filled for open, an outline for a draft, faint for closed.
const DOT: Record<JobStatus, string> = {
	draft: "border-[1.5px] border-ink-muted",
	open: "bg-ink",
	closed: "bg-ink-faint",
};

// The top of the job page: where it sits, its title, a line of facts in mono and the actions. Upload CVs is the
// primary action; the status has its own menu so its effect is spelt out before it changes; everything rarer sits in
// the overflow menu.
export function JobHeader({
	job,
	list,
	capacity,
	status,
	uploadPill,
	onUpload,
}: {
	job: Job;
	// The job's candidates once they have loaded.
	list: CandidateSummary[] | undefined;
	capacity: Capacity;
	status: StatusChange;
	uploadPill: ReactNode;
	onUpload: () => void;
}) {
	return (
		<PageHeader
			breadcrumbs={[{ label: "Jobs", href: "/dashboard/jobs" }, { label: job.title }]}
			title={job.title}
			actions={
				<>
					{uploadPill}
					<button type="button" className="btn" onClick={onUpload}>
						<Upload size={18} aria-hidden="true" />
						Upload CVs
					</button>
					<ShareButton job={job} />
					<StatusMenu job={job} status={status} />
					<MoreMenu job={job} list={list} />
				</>
			}
		>
			{/* Each part brings its own "·" before it; the line starts a little left of the box, which clips it, so a
			    part that wraps to a new line never starts or ends one with a stray dot. */}
			<div className="mt-2 overflow-hidden">
				<p className="-ml-[1.2em] flex flex-wrap items-center gap-y-1 font-mono text-[12.5px] leading-[1.5] text-ink-muted [&>*]:before:inline-block [&>*]:before:w-[1.2em] [&>*]:before:text-center [&>*]:before:content-['·'_/_'']">
					<ReadProgress list={list} />
					<span>{capacity.usage}</span>
					<span>Created {formatDate(job.createdAt)}</span>
					{job.updatedAt !== job.createdAt && <span>Edited {formatDate(job.updatedAt)}</span>}
				</p>
			</div>
			<Processed list={list} />
		</PageHeader>
	);
}

// "3 of 5 read · 1 failed", with the live dot while CVs are still being read. A status region, so screen readers hear
// each change as the scores come in.
function ReadProgress({ list }: { list: CandidateSummary[] | undefined }) {
	const rows = list ?? [];
	const working = rows.some(isWorking);
	const read = rows.filter(({ status }) => status === "scored").length;
	const failed = rows.filter(({ status }) => status === "failed").length;
	return (
		<span role="status" className={`inline-flex items-center empty:hidden ${working ? "text-ink" : ""}`}>
			{working && <span className="live-dot mr-2" aria-hidden="true" />}
			{rows.length > 0 && `${read} of ${rows.length} read${failed > 0 ? ` · ${failed} failed` : ""}`}
		</span>
	);
}

// "All CVs processed" says so when the last CV that was being read in this visit has finished. A list that was never
// working (opened with everything read already) says nothing. The region is always on the page so it is read out.
function Processed({ list }: { list: CandidateSummary[] | undefined }) {
	const rows = list ?? [];
	const working = rows.some(isWorking);
	const [sawWork, setSawWork] = useState(false);
	if (working && !sawWork) setSawWork(true);
	const done = sawWork && !working && rows.length > 0;
	return (
		<p aria-live="polite" className="mt-1 inline-flex items-center gap-2 font-mono text-[12.5px] text-ink empty:hidden">
			{done && (
				<>
					<Check />
					All CVs processed. The list is up to date.
				</>
			)}
		</p>
	);
}

// "● Open ▾": the status in words, and a menu that says what the change does before it happens. While it saves the
// button only looks disabled, so it keeps keyboard focus, and further clicks are ignored.
function StatusMenu({ job, status }: { job: Job; status: StatusChange }) {
	return (
		<Menu
			align="end"
			className="w-[300px]"
			trigger={(props) => (
				<button
					{...props}
					className="btn ghost"
					aria-disabled={status.pending}
					onClick={(event) => {
						if (status.pending) {
							event.preventDefault();
							return;
						}
						props.onClick(event);
					}}
				>
					{status.pending ? (
						"Saving"
					) : (
						<>
							<span className="sr-only">Status:</span>{" "}
							<i className={`size-2 flex-none rounded-full ${DOT[job.status]}`} aria-hidden="true" />
							{STATUS_LABEL[job.status]}
							<ChevronDown size={16} aria-hidden="true" />
						</>
					)}
				</button>
			)}
		>
			<MenuGroup label={status.next.now}>
				<MenuItem description={status.next.effect} onSelect={status.change}>
					{status.next.label}
				</MenuItem>
			</MenuGroup>
		</Menu>
	);
}

// Downloads the job's candidates as a CSV. Kept at page level, not in the menu, so the error toast still shows after
// the menu has closed.
function useExport(jobId: string) {
	const exporter = useExportCsv(jobId);
	const toast = useToast();
	return {
		pending: exporter.isPending,
		run: (choice: ExportChoice) => {
			if (exporter.isPending) return;
			exporter.mutateAsync(choice).then(
				() => toast.show("Downloaded the job's CSV"),
				() => toast.error(EXPORT_FAILED),
			);
		},
	};
}

// Edit, Duplicate, the CSV exports and, for admins, Delete job (behind a confirmation).
function MoreMenu({ job, list }: { job: Job; list: CandidateSummary[] | undefined }) {
	const org = useOrg();
	const navigate = useNavigate();
	const toast = useToast();
	const duplicate = useDuplicateJob(job.id);
	const remove = useDeleteJob(job.id);
	const exporter = useExport(job.id);
	const [confirming, setConfirming] = useState(false);
	// The CVs that go with the job: the ones listed now, or the upload count until the list has loaded.
	const cvs = list?.length ?? job.cvCount;
	const removed = cvs > 0 ? `It and its ${cvs} ${cvs === 1 ? "CV are" : "CVs are"} removed` : "It's removed";

	const copy = () => {
		if (duplicate.isPending) return;
		duplicate.mutate(undefined, {
			onSuccess: (created) =>
				void navigate({ to: "/dashboard/jobs/$jobId/edit", params: { jobId: created.id }, state: { duplicatedJob: true } }),
			onError: (error) => toast.error(error.message),
		});
	};

	return (
		<>
			<Menu
				align="end"
				trigger={(props) => (
					<IconButton {...props} label="More actions" variant="outline" icon={<MoreHorizontal size={20} aria-hidden="true" />} />
				)}
			>
				<MenuItem href={`/dashboard/jobs/${job.id}/edit`} icon={<Pencil aria-hidden="true" />}>
					Edit job
				</MenuItem>
				<MenuItem icon={<CopyPlus aria-hidden="true" />} disabled={duplicate.isPending} onSelect={copy} description="Saves a copy as a draft">
					{duplicate.isPending ? "Duplicating" : "Duplicate"}
				</MenuItem>
				<MenuSeparator />
				<ExportItems pending={exporter.pending} onExport={exporter.run} />
				{org.role === "admin" && (
					<>
						<MenuSeparator />
						<MenuItem destructive icon={<Trash2 aria-hidden="true" />} onSelect={() => setConfirming(true)}>
							Delete job
						</MenuItem>
					</>
				)}
			</Menu>
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
					onConfirm={() =>
						remove.mutate(undefined, {
							onSuccess: () => {
								forgetVisit("job", job.id);
								void navigate({ to: "/dashboard/jobs", state: { deletedJob: job.title } });
							},
						})
					}
				>
					{removed} for everyone at {org.name}. You can't undo this.
				</ConfirmDialog>
			)}
		</>
	);
}
