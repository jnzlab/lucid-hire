import { useEffect, useId, useRef, useState } from "react";
import { DECISION_LABEL, EXPORT_FAILED, type ExportChoice, useExportCsv } from "../lib/candidates.ts";

const CHOICES: { value: ExportChoice; label: string }[] = [
	{ value: "all", label: "All candidates" },
	{ value: "shortlisted", label: DECISION_LABEL.shortlisted },
	{ value: "undecided", label: DECISION_LABEL.undecided },
	{ value: "rejected", label: DECISION_LABEL.rejected },
];

// "Export CSV" with a short menu of which candidates to export. A disclosure, not an ARIA menu: the choices are
// plain buttons, so Tab walks them, Escape closes the list and returns to the button, and a click elsewhere closes it.
export function ExportMenu({ jobId }: { jobId: string }) {
	const exporter = useExportCsv(jobId);
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const listId = useId();

	useEffect(() => {
		if (!open) return;
		const onClick = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			buttonRef.current?.focus();
		};
		document.addEventListener("mousedown", onClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const choose = (choice: ExportChoice) => {
		setOpen(false);
		buttonRef.current?.focus();
		exporter.mutate(choice);
	};

	return (
		<div ref={rootRef} className="relative">
			{/* Only looks busy while the file loads, so it keeps keyboard focus; a second click is ignored. */}
			<button
				ref={buttonRef}
				type="button"
				className="btn ghost"
				aria-expanded={open}
				aria-controls={listId}
				aria-disabled={exporter.isPending}
				onClick={() => {
					if (!exporter.isPending) setOpen(!open);
				}}
			>
				{exporter.isPending ? "Exporting" : "Export CSV"}
			</button>
			{open && (
				<ul
					id={listId}
					className="absolute right-0 z-20 mt-2 min-w-[200px] rounded-xl border border-line bg-sheet p-1.5 shadow-float"
				>
					{CHOICES.map(({ value, label }) => (
						<li key={value}>
							<button
								type="button"
								className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-[15px] hover:bg-paper-2"
								onClick={() => choose(value)}
							>
								{label}
							</button>
						</li>
					))}
				</ul>
			)}
			{exporter.isError && (
				<p role="alert" className="mt-2 text-[14px] text-gap-ink">
					✕ {EXPORT_FAILED}
				</p>
			)}
		</div>
	);
}
