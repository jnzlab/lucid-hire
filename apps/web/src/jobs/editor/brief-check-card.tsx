import { useDeferredValue } from "react";
import { Check } from "../../components/icons.tsx";
import { checkBrief } from "./brief-check.ts";

// Ticks for what the description already covers and ✕ for what it doesn't, each with its words, so colour is never
// the only signal (design system §7). Before anything is written every item waits in a neutral ring: a page of pink
// on an empty form would read as an error. It's advice; saving never waits for it.
export function BriefCheckCard({ description }: { description: string }) {
	const text = useDeferredValue(description);
	const checks = checkBrief(text);
	const started = text.trim().length > 0;
	const met = checks.filter((check) => check.met).length;

	return (
		<section aria-labelledby="brief-check-h" className="rounded-xl bg-sheet p-5 shadow-card min-[561px]:p-6">
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="brief-check-h" className="text-[18px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Brief check
				</h2>
				{started && (
					<p className="font-mono text-[12.5px] text-ink-muted tabular-nums">
						{met} of {checks.length}
					</p>
				)}
			</div>
			<p className="mt-1.5 text-[14px] leading-[1.45] text-ink-muted">
				{started
					? "Advice, not rules. The clearer the brief, the better the ranking."
					: "Checks the description as you write: what helps the AI rank CVs well."}
			</p>
			<ul className="mt-4 flex flex-col gap-3" aria-label="Brief check">
				{checks.map((check) => (
					<li key={check.key} className="flex items-start gap-3">
						<span
							aria-hidden="true"
							className={`mt-px grid size-5 flex-none place-items-center rounded-[4px] text-[12px] leading-none font-bold ${
								!started
									? "bg-paper-2 text-ink-faint"
									: check.met
										? "bg-marker text-on-marker"
										: "bg-gap-soft text-gap-ink"
							}`}
						>
							{!started ? "–" : check.met ? <Check /> : "✕"}
						</span>
						<span className="min-w-0">
							<span className="sr-only">{!started ? "Not checked yet: " : check.met ? "Done: " : "Missing: "}</span>
							<span className={`block text-[15px] leading-[1.35] ${started && check.met ? "text-ink" : "text-ink-2"}`}>
								{check.label}
							</span>
							{started && !check.met && (
								<span className="mt-0.5 block text-[13px] leading-[1.4] text-ink-muted">{check.hint}</span>
							)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
