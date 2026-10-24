import { Sparkles } from "lucide-react";
import { type RefObject, useDeferredValue } from "react";
import { Check } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown-lazy.tsx";
import { ApiError } from "../../lib/api.ts";
import { formatNumber } from "../../lib/format.ts";
import { JOB_DESCRIPTION_MAX } from "../../lib/jobs.ts";
import { UpgradeLink } from "../../settings/upgrade.tsx";
import { Tab, TabList, TabPanel, Tabs } from "../../ui/tabs.tsx";
import { Tooltip } from "../../ui/tooltip.tsx";

export type DescriptionTab = "write" | "preview";

// The description as the apply page will show it: Markdown on a sheet on the desk. Deferred, so typing stays quick
// while a long text is redrawn.
function Preview({ text }: { text: string }) {
	const deferred = useDeferredValue(text);
	return (
		<div className="desk min-h-[360px] rounded-2xl p-[clamp(12px,3vw,24px)]">
			<div className="min-h-[312px] rounded-sheet bg-sheet p-[clamp(18px,3vw,32px)] shadow-sheet">
				{deferred.trim() ? (
					<Markdown>{deferred}</Markdown>
				) : (
					<p className="text-[15px] text-ink-muted">Nothing to preview yet. Write the description, and it shows here as candidates will see it.</p>
				)}
			</div>
		</div>
	);
}

// What the AI is doing, under the field: working (live dot), done (with Undo rewrite) or what went wrong.
function RewriteStatus({
	pending,
	rewritten,
	error,
	onUndo,
}: {
	pending: boolean;
	rewritten: boolean;
	error: Error | null;
	onUndo: () => void;
}) {
	if (pending) {
		return (
			<p role="status" className="inline-flex items-center gap-2.5 font-mono text-[13px] text-ink">
				<span className="live-dot" aria-hidden="true" />
				Rewriting your description · this can take up to a minute
			</p>
		);
	}
	if (error) {
		return (
			<p role="alert" className="text-[14px] text-gap-ink">
				✕ {error.message}
				{error instanceof ApiError && error.code === "plan_limit" && (
					<>
						{" "}
						<UpgradeLink className="text-ink" />
					</>
				)}
			</p>
		);
	}
	if (rewritten) {
		return (
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<p role="status" className="inline-flex items-center gap-2 font-mono text-[13px] text-ink">
					<Check /> Rewritten with AI. Read it before you save.
				</p>
				<button type="button" className="btn ghost xs pointer-coarse:min-h-11" onClick={onUndo}>
					Undo rewrite
				</button>
			</div>
		);
	}
	return null;
}

// The job description: Write and Preview tabs, with "Improve with AI" at the end of the tab row. Every CV is scored
// against this text, so the hint says so. The textarea is read-only while the AI rewrites it.
export function DescriptionField({
	value,
	onChange,
	error,
	tab,
	onTabChange,
	textareaRef,
	saving,
	rewrite,
}: {
	value: string;
	onChange: (value: string) => void;
	error?: string;
	tab: DescriptionTab;
	onTabChange: (tab: DescriptionTab) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	saving: boolean;
	rewrite: { pending: boolean; rewritten: boolean; error: Error | null; improve: () => void; undo: () => void };
}) {
	const helpId = "job-description-help";
	const errorId = "job-description-error";

	return (
		<div>
			<label htmlFor="job-description" className="block text-[14px] font-semibold text-ink">
				Description
			</label>
			<Tabs value={tab} onChange={onTabChange}>
				<div className="mt-2 flex items-end gap-3 border-b border-line">
					<TabList label="Description view" className="min-w-0 flex-1 border-b-0">
						<Tab value="write">Write</Tab>
						<Tab value="preview">Preview</Tab>
					</TabList>
					<Tooltip content="Turns rough notes into clear sections. You can undo it.">
						{/* Only looks disabled while it works, so it keeps keyboard focus; improve() ignores the click. */}
						<button
							type="button"
							className="btn ghost xs mb-1.5 flex-none pointer-coarse:min-h-11"
							onClick={rewrite.improve}
							aria-disabled={rewrite.pending || saving}
						>
							<Sparkles size={16} strokeWidth={2} aria-hidden="true" />
							{rewrite.pending ? "Rewriting" : "Improve with AI"}
						</button>
					</Tooltip>
				</div>
				<TabPanel value="write" focusable={false} className="pt-3">
					<textarea
						ref={textareaRef}
						id="job-description"
						name="description"
						className="field min-h-[360px] resize-y leading-[1.6] [field-sizing:content]"
						placeholder={"What they'll do, what they need, what would be a plus. Rough notes are fine.\n\n## What you'll do\n- …\n\n## Must have\n- …"}
						maxLength={JOB_DESCRIPTION_MAX}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						readOnly={rewrite.pending}
						aria-busy={rewrite.pending || undefined}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? errorId : helpId}
					/>
				</TabPanel>
				<TabPanel value="preview" className="pt-3">
					<Preview text={value} />
				</TabPanel>
			</Tabs>
			<div className="mt-2 flex items-start justify-between gap-4">
				{error ? (
					<p id={errorId} role="alert" className="text-[13px] text-gap-ink">
						✕ {error}
					</p>
				) : (
					<p id={helpId} className="text-[13px] text-ink-muted">
						Markdown works. The requirements every CV is checked against are drafted from this, so name the skills that matter.
					</p>
				)}
				<span className="flex-none font-mono text-[12px] text-ink-muted tabular-nums" aria-hidden="true">
					{formatNumber(value.length)} / {formatNumber(JOB_DESCRIPTION_MAX)}
				</span>
			</div>
			<div className="mt-3 empty:hidden">
				<RewriteStatus pending={rewrite.pending} rewritten={rewrite.rewritten} error={rewrite.error} onUndo={rewrite.undo} />
			</div>
		</div>
	);
}
