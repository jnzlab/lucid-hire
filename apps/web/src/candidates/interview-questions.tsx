import { useEffect, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { ApiError } from "../lib/api.ts";
import type { Candidate } from "../lib/candidates.ts";
import { useInterviewQuestions, useWriteQuestions } from "../lib/interview-questions.ts";
import { UpgradeLink } from "../settings/upgrade.tsx";

// How long "Copied" stays up.
const COPIED_MS = 2000;

// Questions that probe a scored candidate's gaps and check their strongest claims, written by Gemini on request.
// Nothing is shown until the CV is scored.
export function InterviewQuestions({ jobId, candidate }: { jobId: string; candidate: Pick<Candidate, "id" | "status"> }) {
	const scored = candidate.status === "scored";
	const saved = useInterviewQuestions(jobId, candidate.id, scored);
	const write = useWriteQuestions(jobId, candidate.id);
	const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	// The button that wrote the first set goes away with the empty state, so focus moves to the new list.
	const focusList = useRef(false);

	useEffect(() => () => clearTimeout(timer.current), []);

	if (!scored) return null;

	const questions = saved.data?.questions ?? null;

	const writeQuestions = () => {
		if (write.isPending) return;
		clearTimeout(timer.current);
		setCopy("idle");
		write.mutate(undefined, {
			onSuccess: () => {
				focusList.current = questions === null;
			},
		});
	};

	const copyAll = () => {
		if (!questions) return;
		const text = questions.map(({ question }, index) => `${index + 1}. ${question}`).join("\n");
		const done = (state: "copied" | "failed") => {
			setCopy(state);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopy("idle"), COPIED_MS);
		};
		if (!navigator.clipboard?.writeText) return done("failed");
		navigator.clipboard.writeText(text).then(
			() => done("copied"),
			() => done("failed"),
		);
	};

	// Only looks disabled while the questions are written (aria-disabled), so it keeps focus.
	const writeButton = (
		<button
			type="button"
			className={`btn${questions ? " ghost" : ""}`}
			aria-disabled={write.isPending}
			onClick={writeQuestions}
		>
			{write.isPending ? "Writing questions…" : questions ? "Write new questions" : "Write questions"}
		</button>
	);

	return (
		<section aria-labelledby="questions-h" className="mt-10">
			<h2 id="questions-h" className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				Interview questions
			</h2>

			{saved.isPending ? (
				<p role="status" className="mt-4 font-mono text-[13px] text-ink-muted">
					Loading questions
				</p>
			) : saved.isError && !saved.data ? (
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<p role="alert" className="text-[14px] text-gap-ink">
						✕ {saved.error.message}
					</p>
					<button type="button" className="btn ghost" onClick={() => void saved.refetch()}>
						Try again
					</button>
				</div>
			) : (
				<>
					{questions ? (
						<ol
							ref={(list) => {
								if (list && focusList.current) {
									focusList.current = false;
									list.focus();
								}
							}}
							tabIndex={-1}
							aria-labelledby="questions-h"
							className="mt-4 list-decimal rounded-xl bg-sheet py-2 pr-6 pl-12 shadow-card marker:font-mono marker:text-[14px] marker:text-ink-muted"
						>
							{questions.map(({ question, focus }, index) => (
								<li key={`${question}-${index}`} className="border-b border-line-2 py-4 pl-1 last:border-b-0">
									<p className="text-[15px] text-ink [overflow-wrap:anywhere]">{question}</p>
									{focus && (
										<p className="mt-2">
											<span className="inline-flex min-h-6 items-center rounded-md border border-line px-2 font-mono text-[12px] text-ink-muted [overflow-wrap:anywhere]">
												<span className="sr-only">Probes: </span>
												{focus}
											</span>
										</p>
									)}
								</li>
							))}
						</ol>
					) : (
						<p className="mt-2 max-w-[56ch] text-[15px] text-ink-2">
							Questions that probe this candidate's gaps and check their strongest claims.
						</p>
					)}

					<div className="mt-4 flex flex-wrap items-center gap-3">
						{questions && (
							<button type="button" className="btn" onClick={copyAll}>
								Copy all
							</button>
						)}
						{writeButton}
						<p role="status" className="inline-flex items-center gap-2.5 font-mono text-[13px] text-ink empty:hidden">
							{write.isPending ? (
								<>
									<span className="live-dot" aria-hidden="true" />
									Writing questions. This takes 10 to 30 seconds.
								</>
							) : (
								copy === "copied" && (
									<>
										<Check /> Copied
									</>
								)
							)}
						</p>
					</div>
					{copy === "failed" && (
						<p role="alert" className="mt-3 text-[14px] text-gap-ink">
							✕ We couldn't copy the questions. Select them and copy by hand.
						</p>
					)}
					{write.isError && (
						<p role="alert" className="mt-3 text-[14px] text-gap-ink">
							✕ {write.error.message}
							{write.error instanceof ApiError && write.error.code === "plan_limit" && (
								<>
									{" "}
									<UpgradeLink />
								</>
							)}
						</p>
					)}
				</>
			)}
		</section>
	);
}
