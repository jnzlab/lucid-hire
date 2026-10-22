import { Link, useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { IconMore } from "../components/icons.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type JobListItem, useDeleteJob, useDuplicateJob } from "../lib/jobs.ts";
import { publicJobUrl } from "../lib/public-jobs.ts";
import { buildShareLinks, shareTargets } from "../lib/share.ts";
import { useCopy } from "./use-copy.ts";

const item =
	"flex min-h-11 w-full items-center rounded-md px-3 text-left text-[15px] font-[500] text-ink-2 hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2";

// The "..." menu on a job row: Candidates, Edit, Duplicate, the public link and sharing (as on the job's page:
// a draft has no public page, a closed job has one but isn't worth sharing) and, for admins, Delete. A real menu button: Enter,
// Space or the arrow keys open it, the arrows move, Escape closes it and gives focus back.
export function RowActions({ job, onDeleted }: { job: JobListItem; onDeleted: (title: string) => void }) {
	const org = useOrg();
	const navigate = useNavigate();
	const duplicate = useDuplicateJob(job.id);
	const remove = useDeleteJob(job.id);
	const [open, setOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [sharing, setSharing] = useState(false);
	const { message, copy: copyText } = useCopy();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	// Which item takes focus when the menu opens: the first, or (from the Up arrow) the last.
	const startAt = useRef(0);
	const items = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

	useEffect(() => {
		if (!open) return;
		const all = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
		all.at(startAt.current)?.focus();
		// Choosing outside closes the menu without moving focus.
		const close = (event: Event) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	}, [open]);

	const focusItem = (index: number) => {
		const all = items();
		all[(index + all.length) % all.length]?.focus();
	};
	const close = (returnFocus = true) => {
		setOpen(false);
		setSharing(false);
		if (returnFocus) buttonRef.current?.focus();
	};

	const onButtonKey = (event: KeyboardEvent) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			startAt.current = event.key === "ArrowDown" ? 0 : -1;
			setOpen(true);
		}
	};
	const onMenuKey = (event: KeyboardEvent) => {
		const at = items().indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown") focusItem(at + 1);
		else if (event.key === "ArrowUp") focusItem(at - 1);
		else if (event.key === "Home") focusItem(0);
		else if (event.key === "End") focusItem(-1);
		else if (event.key === "Escape") close();
		else if (event.key === "Tab") return setOpen(false);
		else return;
		event.preventDefault();
	};

	const copy = () => {
		close();
		duplicate.mutate(undefined, {
			onSuccess: (created) =>
				void navigate({
					to: "/dashboard/jobs/$jobId/edit",
					params: { jobId: created.id },
					state: { duplicatedJob: true },
				}),
		});
	};
	// The list doesn't carry descriptions, so a caption from here is the title and the link.
	const targets = shareTargets(buildShareLinks({ title: job.title, description: "", slug: job.slug }));
	const hasPublicPage = job.status !== "draft";
	const removed =
		job.cvCount > 0 ? `It and its ${job.cvCount} ${job.cvCount === 1 ? "CV are" : "CVs are"} removed` : "It's removed";

	return (
		<div ref={rootRef} className="relative flex-none">
			<button
				ref={buttonRef}
				type="button"
				aria-label={`Actions for ${job.title}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => {
					startAt.current = 0;
					setOpen(!open);
				}}
				onKeyDown={onButtonKey}
				className="inline-grid size-11 place-items-center rounded-md text-ink-muted hover:bg-paper-2 hover:text-ink"
			>
				<IconMore />
			</button>
			{open && (
				<div
					role="menu"
					aria-label={`Actions for ${job.title}`}
					onKeyDown={onMenuKey}
					className="absolute top-full right-0 z-30 mt-1 w-48 rounded-lg bg-sheet p-1.5 shadow-float"
				>
					<Link
						role="menuitem"
						to="/dashboard/jobs/$jobId"
						params={{ jobId: job.id }}
						className={item}
						onClick={() => close(false)}
					>
						Candidates
					</Link>
					<Link
						role="menuitem"
						to="/dashboard/jobs/$jobId/edit"
						params={{ jobId: job.id }}
						className={item}
						onClick={() => close(false)}
					>
						Edit
					</Link>
					<button type="button" role="menuitem" className={item} onClick={copy}>
						Duplicate
					</button>
					{hasPublicPage && (
						<button
							type="button"
							role="menuitem"
							className={item}
							onClick={() => {
								close();
								void copyText(publicJobUrl(job.slug), "Copied");
							}}
						>
							Copy public link
						</button>
					)}
					{job.status === "open" && (
						<>
							<button
								type="button"
								role="menuitem"
								aria-expanded={sharing}
								className={item}
								onClick={() => setSharing(!sharing)}
							>
								Share
							</button>
							{sharing && (
								<div role="group" aria-label="Share this job" className="ml-3 border-l border-line pl-1">
									{targets.map((target) =>
										"caption" in target ? (
											<button
												key={target.label}
												type="button"
												role="menuitem"
												className={item}
												onClick={() => {
													close();
													void copyText(target.caption, "Caption copied");
												}}
											>
												{target.label}
											</button>
										) : (
											<a
												key={target.label}
												role="menuitem"
												href={target.href}
												{...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
												className={item}
												onClick={() => close(false)}
											>
												{target.label}
											</a>
										),
									)}
								</div>
							)}
						</>
					)}
					{org.role === "admin" && (
						<button
							type="button"
							role="menuitem"
							className={`${item} text-gap-ink hover:text-gap-ink`}
							onClick={() => {
								// Focus goes to the menu button first, so the dialog hands focus back to something that stays.
								close();
								setConfirming(true);
							}}
						>
							Delete
						</button>
					)}
				</div>
			)}
			{duplicate.isPending && (
				<p role="status" className="sr-only">
					Duplicating
				</p>
			)}
			<p
				role="status"
				aria-live="polite"
				className="absolute top-full right-0 z-20 mt-1 rounded-md bg-sheet px-3 py-2 font-mono text-[12.5px] text-ink shadow-float empty:hidden"
			>
				{message}
			</p>
			{duplicate.isError && (
				<p role="alert" className="absolute top-full right-0 z-20 mt-1 w-64 rounded-md bg-sheet p-3 text-[14px] text-gap-ink shadow-float">
					✕ {duplicate.error.message}
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
					onConfirm={() =>
						remove.mutate(undefined, {
							onSuccess: () => {
								setConfirming(false);
								onDeleted(job.title);
							},
						})
					}
				>
					{removed} for everyone at {org.name}. You can't undo this.
				</ConfirmDialog>
			)}
		</div>
	);
}
