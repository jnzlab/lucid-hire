import { Download, Trash2, X } from "lucide-react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { ApiError } from "../lib/api.ts";
import {
	BULK_MAX,
	type BulkDecided,
	type Decision,
	type ExportChoice,
	undoBatches,
	useBulkDecide,
	useBulkDelete,
	useExportCsv,
} from "../lib/candidates.ts";
import { Menu, MenuGroup, MenuItem } from "../ui/menu.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { useToast } from "../ui/use-toast.ts";
import { useToastLift } from "../ui/use-toast-lift.ts";

type BulkBarProps = {
	selectedIds: string[];
	// Empties the selection. Called after a decision or a delete goes through, and by "Clear".
	onClear: () => void;
	// Only admins see Delete (the API refuses anyone else).
	isAdmin: boolean;
	// The job whose CSV Export downloads. Without it there's no Export (the candidates page mixes jobs).
	exportJobId?: string;
	// Where focus goes when the bar leaves the page while it had focus (after an action, or Clear). Usually the
	// list's "select all" checkbox; without it, the page heading.
	returnFocus?: RefObject<HTMLElement | null>;
	// Spacing from the list ("mt-3"). Keep the bar a direct child of the element that holds the list: a sticky
	// element only sticks inside its parent.
	className?: string;
};

type Busy = Decision | "delete" | null;

const count = (n: number) => `${n} ${n === 1 ? "candidate" : "candidates"}`;

// The decisions as the bar's buttons, what a toast says afterwards, and the word an error marks.
const DECISIONS: { value: Decision; label: string; busy: string; done: (n: number) => string; already: string; failed: (n: number) => ReactNode }[] = [
	{
		value: "shortlisted",
		label: "Shortlist",
		busy: "Shortlisting",
		done: (n) => `Shortlisted ${count(n)}`,
		already: "shortlisted",
		failed: (n) => (
			<>
				Couldn't <span className="mk mk-gap">shortlist</span> {count(n)}. Try again.
			</>
		),
	},
	{
		value: "rejected",
		label: "Not a fit",
		busy: "Saving",
		done: (n) => `Marked ${count(n)} not a fit`,
		already: "marked not a fit",
		failed: (n) => (
			<>
				Couldn't mark {count(n)} <span className="mk mk-gap">not a fit</span>. Try again.
			</>
		),
	},
	{
		value: "undecided",
		label: "Undecided",
		busy: "Saving",
		done: (n) => `Moved ${count(n)} back to undecided`,
		already: "undecided",
		failed: (n) => (
			<>
				Couldn't move {count(n)} back to <span className="mk mk-gap">undecided</span>. Try again.
			</>
		),
	},
];

const EXPORTS: { value: ExportChoice; label: string }[] = [
	{ value: "all", label: "All candidates" },
	{ value: "shortlisted", label: "Shortlisted" },
	{ value: "undecided", label: "Undecided" },
	{ value: "rejected", label: "Not a fit" },
];

// The API takes up to BULK_MAX ids a call, and a Max job holds more CVs than that.
const inBatches = (ids: string[]) =>
	Array.from({ length: Math.ceil(ids.length / BULK_MAX) }, (_, index) => ids.slice(index * BULK_MAX, (index + 1) * BULK_MAX));

// What a list shows while candidates are checked: how many, the three decisions, Export (on a job), Delete (admins)
// and Clear. It sticks to the bottom of whatever scrolls the list and sits above the phone tab bar. It fits the
// width it is given (container queries): one row with words on a wide list, icons for Export, Delete and Clear on a
// medium one, and the decisions on a row of their own in a narrow list pane or on a phone. Every action ends in a toast (decisions with Undo); while one runs the
// buttons only look disabled, so focus stays where it was.
export function BulkBar(props: BulkBarProps) {
	if (props.selectedIds.length === 0) return null;
	return <Bar {...props} />;
}

function Bar({ selectedIds, onClear, isAdmin, exportJobId, returnFocus, className = "" }: BulkBarProps) {
	const toast = useToast();
	const bulkDecide = useBulkDecide();
	const bulkDelete = useBulkDelete();
	const exporter = useExportCsv(exportJobId ?? "");
	const [busy, setBusy] = useState<Busy>(null);
	const [confirming, setConfirming] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const rootRef = useRef<HTMLElement>(null);
	useToastLift(rootRef);

	const n = selectedIds.length;
	const working = busy !== null || exporter.isPending;

	// The bar goes when the selection empties. If focus was in it (or in its delete dialog), it would fall to the
	// page's body, so it moves to the list, or the heading, once the bar has left. Layout cleanups run while the bar
	// is still in the page.
	useLayoutEffect(() => {
		const root = rootRef.current;
		// Read when the bar leaves, not now: the list may have re-rendered its checkbox by then.
		const back = returnFocus;
		return () => {
			const active = document.activeElement;
			if (!active || !(root?.contains(active) || active.closest('[role="alertdialog"]'))) return;
			queueMicrotask(() => {
				if (document.activeElement && document.activeElement !== document.body) return;
				const target = back?.current ?? document.querySelector<HTMLElement>("main h1[tabindex]");
				if (target?.isConnected) target.focus({ preventScroll: true });
			});
		};
	}, [returnFocus]);

	const runDecisions = async (batches: { ids: string[]; decision: Decision }[]) => {
		const updated: BulkDecided[] = [];
		for (const batch of batches) {
			for (const ids of inBatches(batch.ids)) updated.push(...(await bulkDecide.mutateAsync({ ids, decision: batch.decision })));
		}
		return updated;
	};

	const undo = async (updated: BulkDecided[]) => {
		try {
			await runDecisions(undoBatches(updated));
			toast.show(`Undone · ${count(updated.length)} back as before`);
		} catch {
			toast.error(
				<>
					Couldn't <span className="mk mk-gap">undo</span> that. Try again.
				</>,
			);
		}
	};

	const decide = async (choice: (typeof DECISIONS)[number]) => {
		if (working) return;
		setBusy(choice.value);
		try {
			const updated = await runDecisions([{ ids: selectedIds, decision: choice.value }]);
			onClear();
			const unchanged = n - updated.length;
			if (updated.length === 0) {
				toast.show(`Nothing changed · ${n === 1 ? "it was" : "all were"} already ${choice.already}`);
			} else {
				toast.show({
					message: unchanged > 0 ? `${choice.done(updated.length)} · ${unchanged} already ${unchanged === 1 ? "was" : "were"}` : choice.done(n),
					action: { label: "Undo", onClick: () => void undo(updated) },
				});
			}
		} catch {
			toast.error(choice.failed(n));
		} finally {
			setBusy(null);
		}
	};

	const confirmDelete = async () => {
		if (busy) return;
		setBusy("delete");
		setDeleteError(null);
		try {
			const deleted = [];
			for (const ids of inBatches(selectedIds)) deleted.push(...(await bulkDelete.mutateAsync(ids)));
			const gone = n - deleted.length;
			setConfirming(false);
			onClear();
			toast.show(gone > 0 ? `Deleted ${count(deleted.length)} · ${gone} ${gone === 1 ? "was" : "were"} already gone` : `Deleted ${count(n)}`);
		} catch (error) {
			setDeleteError(
				error instanceof ApiError && error.status === 403
					? "Only admins can delete candidates."
					: error instanceof ApiError
						? error.message
						: "We couldn't delete the candidates. Try again.",
			);
		} finally {
			setBusy(null);
		}
	};

	const exportCsv = (choice: ExportChoice) => {
		if (working) return;
		exporter.mutate(choice, {
			onSuccess: () => toast.show(choice === "all" ? "Downloaded the job's CSV" : `Downloaded the job's CSV · ${EXPORTS.find(({ value }) => value === choice)?.label}`),
			onError: () =>
				toast.error(
					<>
						Couldn't <span className="mk mk-gap">export</span> the candidates. Try again.
					</>,
				),
		});
	};

	return (
		<section
			ref={rootRef}
			aria-label="Selected candidates"
			className={`@container sticky bottom-4 z-[60] max-md:bottom-[calc(64px+12px+env(safe-area-inset-bottom,0px))] ${className}`}
		>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sheet p-2 shadow-float @2xl:flex-nowrap @2xl:pl-4">
				<p role="status" aria-live="polite" aria-atomic="true" className="order-1 min-w-0 flex-1 pl-2 text-[15px] font-[650] text-ink @2xl:flex-none @2xl:pl-0">
					{n} selected
				</p>

				<div className="order-3 grid w-full grid-cols-3 gap-2 @2xl:order-2 @2xl:flex @2xl:w-auto">
					{DECISIONS.map((choice) => (
						<button
							key={choice.value}
							type="button"
							className={`btn ${choice.value === "shortlisted" ? "" : "ghost"} px-3`}
							aria-disabled={working}
							onClick={() => void decide(choice)}
						>
							{busy === choice.value ? choice.busy : choice.label}
						</button>
					))}
				</div>

				<div className="order-2 flex items-center gap-1 @2xl:order-3 @2xl:flex-1 @3xl:gap-2">
					{exportJobId && (
						<Menu
							side="top"
							align="end"
							trigger={(trigger) => (
								<Tooltip content="Export CSV" describe={false}>
									<button
										{...trigger}
										className="btn ghost px-3"
										aria-disabled={working}
										aria-label="Export CSV"
										onClick={(event) => {
											if (!working) trigger.onClick(event);
										}}
									>
										<Download size={20} aria-hidden="true" />
										<span className="hidden @3xl:inline">{exporter.isPending ? "Exporting" : "Export"}</span>
									</button>
								</Tooltip>
							)}
						>
							<MenuGroup label="Export the job as CSV">
								{EXPORTS.map(({ value, label }) => (
									<MenuItem key={value} onSelect={() => exportCsv(value)}>
										{label}
									</MenuItem>
								))}
							</MenuGroup>
						</Menu>
					)}
					{isAdmin && (
						<Tooltip content={`Delete ${count(n)}`} describe={false}>
							<button
								type="button"
								className="btn danger px-3"
								aria-disabled={working}
								aria-label={`Delete ${count(n)}`}
								onClick={() => {
									if (working) return;
									setDeleteError(null);
									setConfirming(true);
								}}
							>
								<Trash2 size={20} aria-hidden="true" />
								<span className="hidden @3xl:inline">Delete</span>
							</button>
						</Tooltip>
					)}
					<Tooltip content="Clear selection" describe={false}>
						<button
							type="button"
							className="btn ghost border-transparent px-3 @2xl:ml-auto"
							aria-disabled={working}
							aria-label="Clear selection"
							onClick={() => {
								if (!working) onClear();
							}}
						>
							<X size={20} aria-hidden="true" />
							<span className="hidden @3xl:inline">Clear</span>
						</button>
					</Tooltip>
				</div>
			</div>

			{confirming && (
				<ConfirmDialog
					heading={`Delete ${count(n)}?`}
					confirmLabel={`Delete ${count(n)}`}
					busyLabel="Deleting"
					busy={busy === "delete"}
					error={deleteError}
					onCancel={() => setConfirming(false)}
					onConfirm={() => void confirmDelete()}
				>
					They're removed for everyone in your company, with their CV files, and each job still counts their CVs toward
					its CV limit. You can't undo this.
				</ConfirmDialog>
			)}
		</section>
	);
}
