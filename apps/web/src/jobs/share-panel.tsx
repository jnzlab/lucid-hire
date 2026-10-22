import { useEffect, useRef, useState } from "react";
import { type Job } from "../lib/jobs.ts";
import { publicJobUrl } from "../lib/public-jobs.ts";
import { buildShareLinks } from "../lib/share.ts";

const COPIED_MS = 2500;

// Copies text and says so politely. The status line stays in the page so screen readers hear every change.
function useCopy() {
	const [message, setMessage] = useState("");
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const copy = async (text: string, done: string) => {
		window.clearTimeout(timer.current);
		try {
			await navigator.clipboard.writeText(text);
			setMessage(done);
		} catch {
			setMessage("Couldn't copy. Select the text and copy it.");
		}
		timer.current = window.setTimeout(() => setMessage(""), COPIED_MS);
	};
	return { message, copy };
}

const MENU_ITEM = "flex min-h-11 w-full items-center rounded-md px-3 text-left text-[14px] font-semibold hover:bg-marker hover:text-on-marker";

function ShareMenu({ job, copy }: { job: Job; copy: ReturnType<typeof useCopy>["copy"] }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const links = buildShareLinks(job);

	useEffect(() => {
		if (!open) return;
		const away = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			button.current?.focus();
		};
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", escape);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", escape);
		};
	}, [open]);

	const external = { target: "_blank", rel: "noopener noreferrer", className: MENU_ITEM, onClick: () => setOpen(false) } as const;

	return (
		<div ref={root} className="relative">
			<button ref={button} type="button" className="btn ghost" aria-expanded={open} aria-controls="share-menu" onClick={() => setOpen(!open)}>
				Share
			</button>
			{open && (
				<ul id="share-menu" aria-label="Share this job" className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-line bg-sheet p-1.5 shadow-lift">
					<li>
						<a href={links.mailto} className={MENU_ITEM} onClick={() => setOpen(false)}>
							Email
						</a>
					</li>
					<li>
						<a href={links.x} {...external}>
							X
						</a>
					</li>
					<li>
						<a href={links.linkedin} {...external}>
							LinkedIn
						</a>
					</li>
					<li>
						<a href={links.whatsapp} {...external}>
							WhatsApp
						</a>
					</li>
					<li>
						<a href={links.facebook} {...external}>
							Facebook
						</a>
					</li>
					<li>
						<button
							type="button"
							className={MENU_ITEM}
							onClick={() => {
								void copy(links.caption, "Caption copied");
								setOpen(false);
							}}
						>
							Copy caption
						</button>
					</li>
				</ul>
			)}
		</div>
	);
}

// The job's public address with the ways to hand it on. A draft has no public page yet; a closed job still has one
// (it says the role is closed), but isn't worth sharing.
export function PublicLink({ job }: { job: Job }) {
	const { message, copy } = useCopy();
	const url = publicJobUrl(job.slug);

	return (
		<section aria-labelledby="public-link-h" className="mt-6 rounded-xl bg-sheet p-4 shadow-card min-[561px]:p-5">
			<h2 id="public-link-h" className="font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">
				Public link
			</h2>
			{job.status === "draft" ? (
				<p className="mt-2 text-[15px] text-ink-2">Open the job to get a public link.</p>
			) : (
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
					<p className="min-w-0 font-mono text-[13.5px] text-ink [overflow-wrap:anywhere]">{url}</p>
					<div className="flex flex-wrap items-center gap-3">
						<button type="button" className="btn ghost" onClick={() => void copy(url, "Link copied")}>
							Copy link
						</button>
						<a href={url} target="_blank" rel="noopener noreferrer" className="btn ghost">
							Open public page
						</a>
						{job.status === "open" && <ShareMenu job={job} copy={copy} />}
					</div>
				</div>
			)}
			<p role="status" aria-live="polite" className="mt-2 min-h-5 font-mono text-[12.5px] text-ink empty:hidden">
				{message}
			</p>
		</section>
	);
}
