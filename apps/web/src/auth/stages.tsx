import type { ReactNode } from "react";
import { ScoreRing } from "../components/score-ring.tsx";
import { useSequence } from "./use-sequence.ts";

// The desk side of the sign-in, sign-up, onboarding and sign-out pages. Each shows, with sample data, what its heading
// promises: it plays once when the page opens and rests finished (design system §2.6), and its aria-label states the
// end result, so nothing exists only in the animation.

const LABEL = "font-mono text-[10.5px] leading-none tracking-[.1em] text-ink-muted uppercase";

// A marker highlight that sweeps in when `on` turns true. Text on a mark is on-marker; before that it keeps the
// colour around it.
function Mark({ on, gap = false, children }: { on: boolean; gap?: boolean; children: ReactNode }) {
	return (
		<span
			className={`mk transition-[background-size] duration-700 ease-out ${gap ? "mk-gap" : ""} ${on ? "" : "text-inherit [background-size:0%_68%]"}`}
		>
			{children}
		</span>
	);
}

// The status pill (design system §4): the live dot while something is being read.
function Status({ live, children }: { live: boolean; children: ReactNode }) {
	return (
		<p className="mt-5 inline-flex max-w-full min-w-0 items-center gap-2.5 rounded-md bg-sheet px-3.5 py-2.5 font-mono text-[13px] leading-[1.3] text-ink shadow-card">
			{live && <i className="live-dot" />}
			<span className="truncate">{children}</span>
		</p>
	);
}

type Applicant = { name: string; meta: string; score: number };

const GRACE: Applicant = { name: "Grace Turner", meta: "Senior iOS Engineer · London", score: 93 };
const KENJI: Applicant = { name: "Kenji Tanaka", meta: "iOS Developer · Tokyo", score: 71 };
const LUCAS: Applicant = { name: "Lucas Becker", meta: "Swift Developer · Berlin", score: 54 };
const SOPHIA: Applicant = { name: "Sophia Carter", meta: "iOS Engineer · Lisbon", score: 81 };

// Sign-in: Sophia's application arrives, is read and scored, then she moves up to second (ms after the page opens).
const SHORTLIST_STEPS = [1400, 2900, 3700] as const;
const AT_REST: readonly number[] = [];
const ROW_PX = 60;
const ROW = "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3.5";

// The shortlist a recruiter comes back to. `live` plays the new application arriving; without it (sign-out) the
// list is shown as it ends.
export function ShortlistStage({ live = true }: { live?: boolean }) {
	const played = useSequence(live ? SHORTLIST_STEPS : AT_REST);
	const step = live ? played : SHORTLIST_STEPS.length;
	const arrived = step >= 1;
	const scored = step >= 2;
	const ranked = step >= 3;
	// Rows below the top one, in a fixed order so each keeps its element and slides: slot 0 is 2nd place.
	const rows: { applicant: Applicant; slot: number; isNew?: boolean }[] = [
		{ applicant: KENJI, slot: ranked ? 1 : 0 },
		{ applicant: LUCAS, slot: ranked ? 2 : 1 },
		{ applicant: SOPHIA, slot: ranked ? 0 : 2, isNew: true },
	];

	return (
		<figure
			role="img"
			aria-label="A sample shortlist for a Senior iOS Engineer job with 8 of 8 CVs read. Grace Turner is first with 93. Sophia Carter applied while you were away, scored 81 and moved up to second, ahead of Kenji Tanaka with 71 and Lucas Becker with 54."
			className="w-full max-w-[480px]"
		>
			<div className="rounded-xl bg-sheet px-6 pt-5 pb-2 shadow-card max-[560px]:px-4">
				<div className="flex items-end justify-between gap-4">
					<div className="min-w-0">
						<p className={LABEL}>Sample shortlist</p>
						<p className="mt-2 truncate text-[20px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
							Senior iOS Engineer
						</p>
					</div>
					<p className="flex-none font-mono text-[11.5px] text-ink">
						{scored ? "8 of 8" : arrived ? "7 of 8" : "7 of 7"} read
					</p>
				</div>
				<div className={`${ROW} ${LABEL} mt-4 border-y border-line-2 py-2.5`}>
					<span>#</span>
					<span>Candidate</span>
					<span>Match</span>
				</div>
				<div className={`${ROW} rank-band -mx-3.5 mt-2 rounded-md px-3.5 py-3.5`}>
					<span className="font-mono text-[12px]">1</span>
					<span className="min-w-0">
						<span className="block truncate font-display text-[22px] leading-[1.05] font-[800] tracking-[-0.02em] [font-stretch:108%]">
							{GRACE.name}
						</span>
						<span className="mt-1 block truncate font-mono text-[11px]">{GRACE.meta}</span>
					</span>
					<ScoreRing score={GRACE.score} className="mr-2 text-[52px]" />
				</div>
				<div className="relative mt-1" style={{ height: ROW_PX * 3 }}>
					{[2, 3, 4].map((rank, index) => (
						<div
							key={rank}
							className={`${ROW} absolute inset-x-0 border-t border-line-2 font-mono text-[12px] text-ink-muted transition-opacity duration-300 ${rank === 4 && !arrived ? "opacity-0" : ""}`}
							style={{ top: index * ROW_PX, height: ROW_PX }}
						>
							<span>{rank}</span>
						</div>
					))}
					{rows.map(({ applicant, slot, isNew }) => {
						const hidden = isNew && !arrived;
						return (
							<div
								key={applicant.name}
								className={`absolute top-0 right-0 left-[34px] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 transition-[transform,opacity] duration-600 ease-in-out ${hidden ? "opacity-0" : ""}`}
								style={{ height: ROW_PX, transform: `translateY(${slot * ROW_PX + (hidden ? 14 : 0)}px)` }}
							>
								<span className="min-w-0">
									<span className="flex items-center gap-2 text-[16px] leading-[1.2] font-bold">
										<span className="truncate">{applicant.name}</span>
										{isNew && (
											<span className="flex-none rounded-[4px] border border-line px-1.5 py-px font-mono text-[10.5px] font-normal text-ink-muted">
												new
											</span>
										)}
									</span>
									<span className="mt-1 block truncate font-mono text-[11px] text-ink-muted">{applicant.meta}</span>
								</span>
								{isNew && !scored ? (
									<span className="font-mono text-[11.5px] text-ink-muted">Reading</span>
								) : (
									<span className="font-display text-[30px] leading-none font-[800] tabular-nums [font-stretch:62%]">
										{applicant.score}
									</span>
								)}
							</div>
						);
					})}
				</div>
			</div>
			<Status live={arrived && !scored}>
				{!live
					? "Saved · 8 of 8 read"
					: ranked
						? "Sophia Carter moves up to 2nd"
						: scored
							? "Scored 81 · 4 of 6 requirements"
							: arrived
								? "Reading cv_sophia_carter.pdf · 2 pages"
								: "Up to date · 7 of 7 read"}
			</Status>
		</figure>
	);
}

// Sign-up: the first read. Each quote is marked as its requirement is found, the gap is marked pink, then the score
// is ringed (ms after the page opens).
const READING_STEPS = [800, 1500, 2200, 2900, 3600] as const;

const QUOTES = [
	{ before: "Led the ", term: "SwiftUI", after: " rewrite of a banking app used by 2 million people." },
	{ before: "Cut cold launch time by 40% after profiling with ", term: "Instruments", after: "." },
	{ before: "Added ", term: "VoiceOver", after: " and Dynamic Type support across 60 screens." },
];
const REQUIREMENTS = ["SwiftUI", "Instruments", "Accessibility"];

export function ReadingStage() {
	const step = useSequence(READING_STEPS);
	const gapShown = step >= 4;
	const scored = step >= 5;

	return (
		<figure
			role="img"
			aria-label="A sample CV being read for a Senior iOS Engineer job. Grace Turner's CV shows SwiftUI, Instruments and VoiceOver accessibility work, and Kotlin Multiplatform is missing. She scores 93, with 3 of 4 requirements met."
			className="w-full max-w-[480px]"
		>
			<div className="mr-[clamp(16px,9%,56px)] rounded-sheet bg-sheet px-6 pt-5 pb-20 shadow-sheet max-[560px]:px-4">
				<p className={LABEL}>Sample CV</p>
				<p className="mt-3 font-display text-[24px] leading-[1.05] font-[800] tracking-[-0.02em] [font-stretch:108%]">
					Grace Turner
				</p>
				<p className="mt-1 font-mono text-[11.5px] text-ink-muted">Senior iOS Engineer · London</p>
				<p className={`${LABEL} mt-4 border-t border-line-2 pt-3.5`}>Experience</p>
				<ul className="mt-2.5 flex flex-col gap-1.5 text-[14px] leading-[1.5] text-ink-2">
					{QUOTES.map((quote, index) => (
						<li key={quote.term}>
							{quote.before}
							<Mark on={step > index}>{quote.term}</Mark>
							{quote.after}
						</li>
					))}
				</ul>
				<div aria-hidden="true" className="mt-4 flex flex-col gap-2">
					<i className="block h-2 w-[94%] rounded-[4px] bg-line-2" />
					<i className="block h-2 w-[78%] rounded-[4px] bg-line-2" />
				</div>
			</div>
			<div className="relative -mt-14 ml-[clamp(16px,12%,72px)] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl bg-sheet p-5 shadow-float max-[560px]:p-4">
				<div className="min-w-0">
					<p className={LABEL}>Requirements</p>
					<ul className="mt-3 flex flex-col gap-1.5 font-mono text-[12.5px] leading-[1.5]">
						{REQUIREMENTS.map((requirement, index) => (
							<li key={requirement} className="flex justify-between gap-3">
								<span className={step > index ? "" : "text-ink-muted"}>
									<Mark on={step > index}>{requirement}</Mark>
								</span>
								<span className="text-ink-muted">{step > index ? "found" : "…"}</span>
							</li>
						))}
						<li className="flex justify-between gap-3">
							<span className={gapShown ? "" : "text-ink-muted"}>
								<Mark on={gapShown} gap>
									{gapShown ? "✕ " : ""}Kotlin MP
								</Mark>
							</span>
							<span className="text-ink-muted">{gapShown ? "missing" : "…"}</span>
						</li>
					</ul>
				</div>
				{scored ? (
					<ScoreRing score={93} className="mr-2 text-[64px]" />
				) : (
					<span className="invisible mr-2 font-display text-[64px] leading-[.86] font-[800] [font-stretch:62%]">93</span>
				)}
			</div>
			<Status live={!scored}>{scored ? "Scored 93 · 3 of 4 requirements" : "Reading cv_grace_turner.pdf · 2 pages"}</Status>
		</figure>
	);
}

// Onboarding: a sample job page with the company name as it is typed, marked like the one phrase in a heading.
export function CompanyStage({ name }: { name: string }) {
	const company = name.trim().replace(/\s+/g, " ");

	return (
		<figure
			role="img"
			aria-label={`A sample job page: ${company || "your company"} is hiring a Senior iOS Engineer, and candidates apply with their CV.`}
			className="w-full max-w-[480px]"
		>
			<div className="rounded-xl bg-sheet p-6 shadow-card max-[560px]:p-4">
				<p className="truncate font-mono text-[11px] text-ink-muted">lucidhire.io/jobs/senior-ios-engineer-k3m9x2qa</p>
				<p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">
					<span className="inline-flex min-h-7 items-center gap-2 rounded-md border border-line bg-sheet px-2.5 text-[12.5px] tracking-normal text-ink normal-case">
						<i className="size-2 rounded-full bg-ink" />
						Open role
					</span>
					<span className="max-w-full [overflow-wrap:anywhere]">
						{company ? <span className="mk">{company}</span> : "Your company"}
					</span>
					<span>Posted today</span>
				</p>
				<p className="mt-3 font-display text-[clamp(26px,3vw,34px)] leading-[.98] font-[820] tracking-[-0.038em] [font-stretch:112%]">
					Senior iOS Engineer
				</p>
				<div aria-hidden="true" className="mt-5 flex flex-col gap-2 rounded-sheet bg-paper p-4">
					<i className="block h-2 w-[90%] rounded-[4px] bg-line" />
					<i className="block h-2 w-[96%] rounded-[4px] bg-line" />
					<i className="block h-2 w-[64%] rounded-[4px] bg-line" />
				</div>
				<span className="btn ghost pointer-events-none mt-5 w-full">Submit application</span>
			</div>
		</figure>
	);
}
