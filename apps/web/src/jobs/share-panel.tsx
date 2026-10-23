import { Copy, ExternalLink, Share2 } from "lucide-react";
import type { Job } from "../lib/jobs.ts";
import { publicJobUrl } from "../lib/public-jobs.ts";
import { buildShareLinks, shareTargets } from "../lib/share.ts";
import { Popover } from "../ui/popover.tsx";
import { useCopy } from "./use-copy.ts";

const TARGET =
	"inline-flex min-h-11 items-center justify-center rounded-md border-[1.5px] border-line bg-sheet px-3 text-[14px] font-semibold text-ink hover:border-ink";

// The job's apply link with the ways to hand it on: copy it, open it, or send it somewhere. A draft has no public page
// yet; a closed job still has one (it says the role is closed) but isn't worth sharing, so it gets no share targets.
export function SharePanel({ job }: { job: Job }) {
	const { message, copy } = useCopy();
	const url = publicJobUrl(job.slug);
	const targets = shareTargets(buildShareLinks(job));

	return (
		<div className="flex w-[min(360px,calc(100vw-48px))] flex-col gap-3">
			<h2 className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">Apply link</h2>
			{job.status === "draft" ? (
				<p className="text-[15px] text-ink-2">Open the job to get a public link.</p>
			) : (
				<>
					<p className="rounded-md border-[1.5px] border-line bg-paper px-3 py-2.5 font-mono text-[13px] leading-[1.4] text-ink [overflow-wrap:anywhere] select-all">
						{url}
					</p>
					<div className="flex flex-wrap gap-2">
						<button type="button" className="btn xs" onClick={() => void copy(url, "Link copied")}>
							<Copy size={16} aria-hidden="true" />
							Copy link
						</button>
						<a href={url} target="_blank" rel="noopener noreferrer" className="btn ghost xs">
							<ExternalLink size={16} aria-hidden="true" />
							Open public page
						</a>
					</div>
					{job.status === "closed" ? (
						<p className="text-[14px] text-ink-muted">The job is closed, so its page says it isn't taking CVs.</p>
					) : (
						<div role="group" aria-label="Share to" className="flex flex-wrap gap-2 border-t border-line-2 pt-3">
							{targets.map((target) =>
								"caption" in target ? (
									<button key={target.label} type="button" className={TARGET} onClick={() => void copy(target.caption, "Caption copied")}>
										{target.label}
									</button>
								) : (
									<a
										key={target.label}
										href={target.href}
										className={TARGET}
										{...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
									>
										{target.label}
									</a>
								),
							)}
						</div>
					)}
				</>
			)}
			{/* Always in the panel, so screen readers hear each change. */}
			<p role="status" className="font-mono text-[12.5px] text-ink empty:sr-only">
				{message}
			</p>
		</div>
	);
}

// "Share" in the job page's header: the apply link in a popover.
export function ShareButton({ job }: { job: Job }) {
	return (
		<Popover
			label="Share this job"
			align="end"
			trigger={
				<>
					<Share2 size={18} aria-hidden="true" />
					Share
				</>
			}
		>
			<SharePanel job={job} />
		</Popover>
	);
}
