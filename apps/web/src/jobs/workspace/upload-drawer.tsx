import { FileUp } from "lucide-react";
import type { ReactNode } from "react";
import { UploadZone } from "../../candidates/upload-zone.tsx";
import { cvNoun } from "../../lib/candidates.ts";
import { formatNumber } from "../../lib/format.ts";
import type { Job } from "../../lib/jobs.ts";
import { Drawer } from "../../ui/drawer.tsx";
import type { Capacity } from "./capacity.ts";
import { type Uploads, isPending } from "./uploads.ts";

// "Upload CVs" opens this drawer from the right (a bottom sheet on a phone). The upload itself belongs to the page, so
// files keep going up when the drawer is closed, and their results are here when it opens again.
export function UploadDrawer({
	open,
	onClose,
	job,
	capacity,
	uploads,
	withDetails,
	onWithDetailsChange,
	noteAction,
}: {
	open: boolean;
	onClose: () => void;
	job: Job;
	capacity: Capacity;
	uploads: Uploads;
	withDetails: boolean;
	onWithDetailsChange: (on: boolean) => void;
	noteAction?: ReactNode;
}) {
	return (
		<Drawer
			open={open}
			onClose={onClose}
			title="Upload CVs"
			width={520}
			description={
				<>
					To <span className="font-[650] text-ink">{job.title}</span>
					<span className="mt-1 block font-mono text-[12.5px] text-ink-muted">
						{formatNumber(capacity.slotsLeft)} of {formatNumber(capacity.limit)} {cvNoun(capacity.limit)} left on this job
					</span>
				</>
			}
		>
			<UploadZone
				uploads={uploads}
				withDetails={withDetails}
				onWithDetailsChange={onWithDetailsChange}
				note={capacity.note}
				noteAction={noteAction}
				slotsLeft={capacity.slotsLeft}
				limit={capacity.limit}
			/>
		</Drawer>
	);
}

// The header's reminder that files are still going up while the drawer is closed ("Uploading 3 of 5"), or that some of
// the last batch didn't make it. It opens the drawer.
export function UploadPill({ uploads, failedUnseen, onOpen }: { uploads: Uploads; failedUnseen: boolean; onOpen: () => void }) {
	const sent = uploads.items.filter(({ state }) => state !== "staged");
	const busy = sent.some(isPending);
	const failed = sent.filter(({ state }) => state === "failed").length;
	if (!busy && !(failedUnseen && failed > 0)) return null;
	const started = sent.filter(({ state }) => state !== "waiting").length;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="inline-flex min-h-[42px] items-center gap-2.5 rounded-md border-[1.5px] border-line bg-sheet px-3.5 font-mono text-[13px] text-ink shadow-card hover:border-ink pointer-coarse:min-h-11"
		>
			{busy ? (
				<>
					<span className="live-dot" aria-hidden="true" />
					Uploading {started} of {sent.length}
				</>
			) : (
				<span className="text-gap-ink">✕ {failed} not uploaded</span>
			)}
			<span className="sr-only">. Show the uploads</span>
		</button>
	);
}

// What covers the page while CVs are dragged over it: where they will go, or why they can't. It never takes the
// pointer, so the drag events still reach the page underneath.
export function DropOverlay({ jobTitle, blocked }: { jobTitle: string; blocked: string | null }) {
	return (
		<div className="layer-modal pointer-events-none fixed inset-0 grid place-items-center bg-overlay p-6" aria-hidden="true">
			<div
				className={`flex w-[min(520px,100%)] flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-sheet px-8 py-10 text-center shadow-float ${blocked ? "border-gap-ink" : "border-ink"}`}
			>
				<FileUp size={36} strokeWidth={1.75} aria-hidden="true" className={blocked ? "text-gap-ink" : "text-ink"} />
				{blocked ? (
					<p className="text-[17px] leading-[1.4] font-[650] text-ink">
						<span className="mk mk-gap">✕ Can't add CVs</span>
						<span className="mt-2 block text-[15px] font-normal text-ink-2">{blocked}</span>
					</p>
				) : (
					<p className="text-[22px] leading-[1.15] font-[800] tracking-[-0.02em] [overflow-wrap:anywhere] [font-stretch:108%]">
						Drop CVs to add them to <span className="mk">{jobTitle}</span>
						<span className="mt-2 block font-mono text-[12.5px] font-normal tracking-normal text-ink-muted">
							PDF only · up to 5 MB each
						</span>
					</p>
				)}
			</div>
		</div>
	);
}
