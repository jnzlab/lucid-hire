import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NARROW, REDUCED_MOTION, useMediaQuery, vars } from "./dom.ts";
import { RING_PATH } from "./ui.tsx";

const STEPS: { label: string; title: ReactNode; body: string }[] = [
	{
		label: "The pile",
		title: (
			<>
				You posted one job. <span className="mk">Now there's a pile.</span>
			</>
		),
		body: "Seven applications for a Senior iOS Engineer by Monday morning. Seven layouts, seven ways to say Swift, and no spare morning to read them properly.",
	},
	{
		label: "Read",
		title: (
			<>
				LucidHire reads <span className="mk">every page.</span>
			</>
		),
		body: "Every line of every CV, page two included. Nobody gets skimmed because they applied late or picked an unusual template.",
	},
	{
		label: "Mark",
		title: (
			<>
				It marks what matches, <span className="mk mk-gap">and what's missing.</span>
			</>
		),
		body: "Yellow for evidence of a requirement, pink for a requirement it couldn't find. Every mark gets a number, so you can check it against the CV yourself.",
	},
	{
		label: "Score",
		title: (
			<>
				Then it scores, <span className="mk">and shows its working.</span>
			</>
		),
		body: "Grace gets 93. All four must-haves are there, plus one of the two nice-to-haves. Each point in the score cites the line it came from.",
	},
	{
		label: "Rank",
		title: (
			<>
				Everyone lands on <span className="mk">one ranked list.</span>
			</>
		),
		body: "Grace applied sixth and goes straight to first. The list re-sorts itself as new CVs arrive, so the strongest match is always the top row.",
	},
	{
		label: "Meet",
		title: (
			<>
				You meet the best ones, <span className="mk">prepared.</span>
			</>
		),
		body: "Open a finalist and you get the evidence, plus interview questions aimed at their gaps. Shortlisting or passing stays your call.",
	},
];

const RAIL = ["Pile", "Read", "Mark", "Score", "Rank", "Meet"];

const STATUS = [
	"Senior iOS Engineer · 7 applications",
	"Reading cv_grace_turner.pdf · 2 pages",
	"Checking 6 requirements",
	"Scored 93 · 5 of 6 requirements",
	"Shortlist · sorted by match",
	"Interview questions ready",
];

// The camera frame per scene, as [x, y, w, h] in world units.
const FRAMES = {
	wide: [
		[150, 90, 600, 580],
		[262, 172, 376, 420],
		[262, 172, 376, 420],
		[184, 168, 600, 430],
		[195, 86, 505, 470],
		[190, 56, 520, 610],
	],
	narrow: [
		[200, 110, 520, 520],
		[284, 196, 332, 300],
		[284, 280, 332, 280],
		[420, 172, 370, 340],
		[205, 160, 490, 390],
		[240, 370, 390, 300],
	],
} as const;

const PILE = [
	{ name: "Sophia Carter", role: "Frontend Engineer · Toronto", px: 352, py: 112, pr: 11 },
	{ name: "Lucas Becker", role: "Swift Developer · Berlin", px: 214, py: 236, pr: -4 },
	{ name: "Kenji Tanaka", role: "iOS Developer · Tokyo", px: 246, py: 138, pr: -10 },
	{ name: "Amelia Nguyen", role: "Mobile Engineer · Melbourne", px: 334, py: 194, pr: 7 },
	{ name: "Rayan Al-Farsi", role: "Android Developer · Dubai", px: 300, py: 262, pr: -13 },
	{ name: "Oliver Hayes", role: "Junior iOS Developer · Dublin", px: 338, py: 222, pr: 4 },
];

const EVIDENCE = [
	{ text: "Led a SwiftUI migration", kind: "Must" },
	{ text: "Profiles with Instruments", kind: "Must" },
	{ text: "Accessibility audits", kind: "Must" },
	{ text: "Swift since 2019", kind: "Must" },
	{ text: "GraphQL with Apollo", kind: "Nice" },
	{ text: "No Kotlin Multiplatform", kind: "Nice", gap: true },
];

// a = order of arrival, r = rank once scored.
const LEADERBOARD = [
	{ time: "08:15", name: "Sophia Carter", role: "Frontend Engineer · Toronto", score: 25, a: 0, r: 5 },
	{ time: "08:31", name: "Lucas Becker", role: "Swift Developer · Berlin", score: 54, a: 1, r: 2 },
	{ time: "08:47", name: "Kenji Tanaka", role: "iOS Developer · Tokyo", score: 71, a: 2, r: 1 },
	{ time: "09:02", name: "Amelia Nguyen", role: "Mobile Engineer · Melbourne", score: 50, a: 3, r: 3 },
	{ time: "09:20", name: "Rayan Al-Farsi", role: "Android Developer · Dubai", score: 46, a: 4, r: 4 },
	{ time: "09:41", name: "Grace Turner", role: "Senior iOS Engineer · London", score: 93, a: 5, r: 0, me: true },
	{ time: "09:58", name: "Oliver Hayes", role: "Junior iOS Developer · Dublin", score: null, a: 6, r: 6 },
];

function Bars() {
	return (
		<div className="bars">
			{Array.from({ length: 10 }, (_, i) => (
				<i key={i} />
			))}
		</div>
	);
}

function PileSheet({ sheet, index }: { sheet: (typeof PILE)[number]; index: number }) {
	return (
		<div
			className="sh other"
			style={vars({ "--px": `${sheet.px}px`, "--py": `${sheet.py}px`, "--pr": `${sheet.pr}deg`, "--i": index })}
		>
			<b>{sheet.name}</b>
			<small>{sheet.role}</small>
			<Bars />
		</div>
	);
}

function Highlight({ delay, children, note }: { delay: number; children: ReactNode; note: number }) {
	return (
		<>
			<span className="mk hl" style={vars({ "--d": delay })}>
				{children}
			</span>
			<i className="fn" style={vars({ "--d": delay })}>
				{note}
			</i>
		</>
	);
}

function GraceCv() {
	return (
		<article className="sh cv" id="grace">
			<div className="cv-top">
				<div className="cv-name">Grace Turner</div>
				<div className="cv-pg">p. 1 of 2</div>
			</div>
			<div className="cv-role">Senior iOS Engineer · London</div>
			<div className="cv-sec">Experience</div>
			<div className="cv-job">
				<b>Kestrel Health</b>
				<span>Lead iOS Engineer · 2021–now</span>
			</div>
			<ul>
				<li>
					Led the move of a 400k-user app to{" "}
					<Highlight delay={0} note={1}>
						SwiftUI
					</Highlight>
				</li>
				<li>
					Cut cold start by 38% with{" "}
					<Highlight delay={0.3} note={2}>
						Instruments
					</Highlight>
				</li>
				<li>
					Runs quarterly{" "}
					<Highlight delay={0.6} note={3}>
						accessibility audits
					</Highlight>
				</li>
			</ul>
			<div className="cv-job">
				<b>Parcel Pigeon</b>
				<span>iOS Engineer · 2019–2021</span>
			</div>
			<ul>
				<li>
					Built the offline sync layer in{" "}
					<Highlight delay={0.9} note={4}>
						Swift
					</Highlight>
				</li>
				<li>
					Shipped a{" "}
					<Highlight delay={1.2} note={5}>
						GraphQL client with Apollo
					</Highlight>
				</li>
			</ul>
			<div className="cv-sec">Skills</div>
			<p className="cv-skills">Swift · SwiftUI · Combine · Core Data · XCTest</p>
			<div className="gap-note">
				<i className="fn">6</i>
				<span>
					<b>Not found</b>
					<br />
					Kotlin Multiplatform
				</span>
			</div>
			<div className="scan" />
		</article>
	);
}

function ScoreCard() {
	return (
		<div className="card">
			<p className="eyebrow">Match score</p>
			<div className="big-score num">
				93
				<svg viewBox="0 0 160 130" preserveAspectRatio="none">
					<path className="ring" pathLength="1" d={RING_PATH} />
				</svg>
			</div>
			<p className="sum">Must-haves 4 of 4 · Nice 1 of 2</p>
			<ol className="ev">
				{EVIDENCE.map((item, j) => (
					<li key={item.text} className={item.gap ? "gap" : undefined} style={vars({ "--j": j })}>
						<i className="fn">{j + 1}</i>
						{item.text}
						<em>{item.kind}</em>
					</li>
				))}
			</ol>
		</div>
	);
}

function Leaderboard() {
	return (
		<div className="lb">
			<div className="lb-h">
				<b>Senior iOS Engineer</b>
				<span>Live · 7 applied</span>
			</div>
			<div className="cols">
				<span className="c">
					<span className="k1">Arrived</span>
					<span className="k2">Rank</span>
				</span>
				<span>Candidate</span>
				<span>Match</span>
			</div>
			<div className="rows">
				{LEADERBOARD.map((row) => (
					<div
						key={row.name}
						className={row.me ? "row me" : row.score === null ? "row wait" : "row"}
						style={vars({ "--a": row.a, "--r": row.r })}
					>
						<span className="c">
							<span className="t">{row.time}</span>
							<span className="rk">{row.r + 1}</span>
						</span>
						<span className="n">
							<b className={row.me ? "mk" : undefined}>{row.name}</b>
							<small>{row.role}</small>
						</span>
						{row.score === null ? (
							<span className="s">
								reading
								<span className="dots">
									<i>.</i>
									<i>.</i>
									<i>.</i>
								</span>
							</span>
						) : (
							<span className="s num">{row.score}</span>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function InterviewCard() {
	return (
		<div className="ask">
			<div className="ask-top">
				<span>Grace Turner · 93 · 1st of 7</span>
				<span>Interview prep</span>
			</div>
			<h4>Questions to ask Grace</h4>
			<ol>
				<li>
					<span className="mk mk-gap">Kotlin Multiplatform</span> is on our roadmap. Have you shared code
					between iOS and Android?
				</li>
				<li>Walk us through the SwiftUI move. What stayed in UIKit, and why?</li>
				<li>What did Instruments show you before the cold-start fix?</li>
			</ol>
			<div className="dec">
				<span className="chip yes">
					<svg viewBox="0 0 14 14">
						<path
							pathLength="1"
							d="M2 7.5 5.5 11 12 3.5"
							fill="none"
							stroke="#141414"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					Shortlist
				</span>
				<span className="chip">Not a fit</span>
			</div>
		</div>
	);
}

export function Story() {
	const [scene, setScene] = useState(0);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const narrow = useMediaQuery(NARROW);
	const stage = useRef<HTMLDivElement>(null);
	const world = useRef<HTMLDivElement>(null);
	const steps = useRef<(HTMLElement | null)[]>([]);
	const heldUntil = useRef(0);
	const placed = useRef(false);

	// The step whose first line has passed the reading line picks the scene. Scroll position is
	// used instead of an IntersectionObserver, as in the prototype (design doc §1).
	const pick = useCallback(() => {
		if (Date.now() < heldUntil.current) return;
		const line = window.innerHeight * (window.matchMedia(NARROW).matches ? 0.8 : 0.6);
		let next = 0;
		steps.current.forEach((step, j) => {
			const head = step?.firstElementChild;
			if (head && head.getBoundingClientRect().top <= line) next = j;
		});
		setScene(next);
	}, []);

	useEffect(() => {
		let frame = 0;
		const onScroll = () => {
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					pick();
				});
		};
		pick();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [pick]);

	useEffect(() => {
		const el = stage.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// The camera frames the current scene inside the stage, keeping the status line clear.
	useLayoutEffect(() => {
		const el = world.current;
		const { w, h } = size;
		if (!el || !w || !h) return;
		const hud = narrow ? 44 : 62;
		const pad = narrow ? 8 : 14;
		const [fx, fy, fw, fh] = FRAMES[narrow ? "narrow" : "wide"][scene];
		const aw = w - pad * 2;
		const ah = h - hud - pad;
		const s = Math.max(Math.min(aw / fw, ah / fh, narrow ? 1.35 : 1.7), 0.3);
		const tx = pad + (aw - fw * s) / 2 - fx * s;
		const ty = pad + (ah - fh * s) / 2 - fy * s;
		if (!placed.current) {
			// The first frame jumps into place instead of gliding from the default transform.
			el.style.transition = "none";
			el.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
			void el.offsetWidth;
			el.style.transition = "";
			placed.current = true;
			return;
		}
		el.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
	}, [scene, size, narrow]);

	const jumpTo = useCallback(
		(i: number) => {
		const head = steps.current[i]?.firstElementChild;
		if (!head) return;
		const reduce = window.matchMedia(REDUCED_MOTION).matches;
		const want = window.innerHeight * (window.matchMedia(NARROW).matches ? 0.7 : 0.36);
		heldUntil.current = Date.now() + (reduce ? 0 : 1000);
		setScene(i);
		window.scrollTo({
			top: Math.max(window.scrollY + head.getBoundingClientRect().top - want, 0),
			behavior: reduce ? "auto" : "smooth",
		});
		setTimeout(pick, reduce ? 0 : 1050);
		},
		[pick],
	);

	return (
		<section className="story" id="story" aria-labelledby="story-h">
			<div className="wrap">
				<div className="story-head">
					<h2 id="story-h">
						Follow one CV from the pile to the <span className="mk mk-v">interview.</span>
					</h2>
					<div className="side">
						<p>Six short scenes with sample candidates. Scroll at your own pace, or jump with the chapter bar.</p>
						<a href="#how">Skip the story</a>
					</div>
				</div>

				<div className="story-grid">
					<div className="steps">
						{STEPS.map((step, i) => (
							<article
								key={step.label}
								ref={(el) => {
									steps.current[i] = el;
								}}
								className={i === scene ? "step on" : "step"}
							>
								<p className="eyebrow">
									<b>{String(i + 1).padStart(2, "0")}</b> / 06 · {step.label}
								</p>
								<h3>{step.title}</h3>
								<p>{step.body}</p>
							</article>
						))}
					</div>

					<div className="sticky">
						<div className="stagewrap" id="stage" data-scene={scene} ref={stage} aria-hidden="true">
							<div className="hud">
								<p className="status">
									{STATUS.map((text, i) => (
										<span key={text} className="st" data-s={i}>
											{text}
										</span>
									))}
								</p>
								<span className="sample">Sample data</span>
							</div>

							<div className="world" ref={world}>
								{PILE.slice(0, 4).map((sheet, i) => (
									<PileSheet key={sheet.name} sheet={sheet} index={i} />
								))}
								<GraceCv />
								{PILE.slice(4).map((sheet, i) => (
									<PileSheet key={sheet.name} sheet={sheet} index={i + 4} />
								))}
								<ScoreCard />
								<Leaderboard />
								<div className="jump">
									Applied 6th. Ranked 1st.
									<svg viewBox="0 0 56 130" style={{ height: 130 }}>
										<path pathLength="1" d="M50 4C52 50 40 96 9 124m0 0 2-12M9 124l11-5" />
									</svg>
								</div>
								<InterviewCard />
							</div>
						</div>
						<div className="rail" role="group" aria-label="Story chapters">
							{RAIL.map((label, i) => (
								<button
									key={label}
									type="button"
									className={i < scene ? "done" : undefined}
									aria-current={i === scene ? "step" : undefined}
									onClick={() => jumpTo(i)}
								>
									<b>{String(i + 1).padStart(2, "0")}</b>
									<span>{label}</span>
								</button>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
