import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { ScoreRing } from "../../components/score-ring.tsx";
import { type Candidate, SLOW_CHECK_MS, candidateEmail, isEmail, isSlow, isWorking } from "../../lib/candidates.ts";
import { telHref } from "../../lib/contact.ts";
import { formatDate, formatRelative } from "../../lib/format.ts";
import { useNow } from "../../lib/use-now.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { metCount } from "./requirements.ts";

// Only mounted while the CV is being read, so the clock that decides "taking longer than usual" ticks only then.
function StillReading({ candidate, retry }: { candidate: Candidate; retry: ReactNode }) {
	const now = useNow(SLOW_CHECK_MS);
	const slow = isSlow(candidate, now);
	if (!slow && !candidate.canRetry) return null;
	return (
		<div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-[560px]:justify-start">
			{slow && <p className="font-mono text-[12.5px] text-ink-muted">This is taking longer than usual.</p>}
			{retry}
		</div>
	);
}

// The score with the screen's one ink ring, how many requirements the CV meets and its rank among the job's scored
// CVs; while the CV is being read, the reading pill (and "taking longer than usual" with Retry). The ring and the
// pill share one status region, so the change from reading to scored is announced. The rank sits outside it: it
// moves as other CVs are scored, and that shouldn't be read out every time.
export function ScoreBlock({ candidate, retry, size }: { candidate: Candidate; retry: ReactNode; size: "page" | "panel" }) {
	const working = isWorking(candidate);
	const score = candidate.status === "scored" ? candidate.score : null;
	const requirements = candidate.requirements ?? [];
	return (
		<div className="flex flex-col items-end gap-2 text-right max-[560px]:items-start max-[560px]:text-left">
			<div role="status" className="flex flex-col items-end gap-2 empty:hidden max-[560px]:items-start">
				{working && (
					<p className="inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card">
						<span className="live-dot" aria-hidden="true" />
						Reading the CV
					</p>
				)}
				{score !== null && (
					<>
						<span className={size === "page" ? "px-4 pt-1 text-[64px]" : "px-3 pt-1 text-[48px]"}>
							<span className="sr-only">Score </span>
							<ScoreRing score={score} />
						</span>
						{requirements.length > 0 && (
							<span className="font-mono text-[12.5px] text-ink-2">
								<span className="sr-only">· </span>
								{metCount(requirements)} requirements met
							</span>
						)}
					</>
				)}
			</div>
			{candidate.rank !== null && (
				<p className="font-mono text-[12.5px] text-ink-muted">
					Ranked #{candidate.rank} of {candidate.rankedCount}
				</p>
			)}
			{working && <StillReading candidate={candidate} retry={retry} />}
		</div>
	);
}

// "just now", "5 min ago", "yesterday" or the date, to follow "Uploaded".
function uploadedAgo(iso: string, now: number) {
	const ago = formatRelative(iso, now);
	return ago === "Just now" || ago === "Yesterday" ? ago.toLowerCase() : ago;
}

// Under the name: how to reach the candidate and where the CV came from. The address the applicant gave when applying
// wins over the one on the CV, and only one that passes the strict rule becomes a mailto: link.
export function MetaRow({ candidate, onCopyEmail }: { candidate: Candidate; onCopyEmail: (email: string) => void }) {
	const now = useNow(60_000);
	const email = candidateEmail(candidate);
	const phone = candidate.profile?.phone;
	const location = candidate.profile?.location;
	const item = "inline-flex min-h-8 items-center [&+&]:before:mr-3 [&+&]:before:text-ink-faint [&+&]:before:content-['·']";
	return (
		<div className="mt-3 flex flex-col gap-1 font-mono text-[13px] text-ink-muted">
			<ul aria-label="Contact" className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<li className={item}>
					{!email ? (
						"No email provided"
					) : (
						<>
							{isEmail(email) ? (
								<a href={`mailto:${email}`} className="text-ink underline underline-offset-[.18em] [overflow-wrap:anywhere]">
									{email}
								</a>
							) : (
								<span className="text-ink [overflow-wrap:anywhere]">{email}</span>
							)}
							<IconButton
								label="Copy email"
								icon={<Copy size={16} strokeWidth={2} aria-hidden="true" />}
								className="-my-2 -mr-2 ml-0.5"
								onClick={() => onCopyEmail(email)}
							/>
						</>
					)}
				</li>
				{phone && (
					<li className={item}>
						<a href={telHref(phone)} className="underline underline-offset-[.18em] hover:text-ink">
							{phone}
						</a>
					</li>
				)}
				{location && <li className={`${item} [overflow-wrap:anywhere]`}>{location}</li>}
			</ul>
			<p className="flex flex-wrap items-center gap-x-3 gap-y-1">
				{candidate.source === "apply" && (
					<span className="rounded-md border border-line bg-paper-2 px-2 py-0.5 text-ink-2">Applied through the job page</span>
				)}
				<span title={formatDate(candidate.createdAt)} className="inline-flex min-h-8 items-center">
					Uploaded {uploadedAgo(candidate.createdAt, now)}
				</span>
			</p>
		</div>
	);
}
