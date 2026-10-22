import { useEffect, useRef } from "react";
import { ArrowRight } from "../components/icons.tsx";
import { Swipe } from "../components/swipe.tsx";
import { REDUCED_MOTION, vars } from "./dom.ts";
import { ArrowDown, RING_PATH, SignUpCta, Tick } from "./ui.tsx";

const ARTBOARD_WIDTH = 520;

// The artboard is laid out at 520px and zoomed to fit, so its text stays sharp (design system §2.6).
function useFitScale() {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const fit = () => {
			const k = Math.min(Math.max(el.clientWidth / ARTBOARD_WIDTH, 0.3), 1.2);
			el.style.setProperty("--k", k.toFixed(4));
		};
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return ref;
}

// The pile behind the shortlist drifts a few pixels with the pointer; the list itself stays put.
function usePointerDrift() {
	const section = useRef<HTMLElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const hero = section.current;
		if (!hero || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
		if (window.matchMedia(REDUCED_MOTION).matches) return;
		let frame = 0;
		let mx = 0;
		let my = 0;
		const onMove = (e: PointerEvent) => {
			mx = e.clientX / window.innerWidth - 0.5;
			my = e.clientY / window.innerHeight - 0.5;
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					stage.current?.style.setProperty("--mx", mx.toFixed(3));
					stage.current?.style.setProperty("--my", my.toFixed(3));
				});
		};
		hero.addEventListener("pointermove", onMove);
		return () => {
			hero.removeEventListener("pointermove", onMove);
			cancelAnimationFrame(frame);
		};
	}, []);
	return { section, stage };
}

function Pen() {
	return (
		<span className="pen-track" aria-hidden="true">
			<svg className="pen" viewBox="0 0 160 46">
				<path d="M30 32 10 26.5 4 15h26z" fill="#FFE84A" stroke="#141414" strokeWidth="3" strokeLinejoin="round" />
				<rect x="28" y="11" width="16" height="25" rx="2" fill="#F5F5F1" stroke="#141414" strokeWidth="3" />
				<rect x="42" y="7" width="112" height="33" rx="9" fill="#FFE84A" stroke="#141414" strokeWidth="3" />
				<rect x="110" y="7" width="44" height="33" rx="9" fill="#141414" />
				<path d="M58 17h38" stroke="#141414" strokeWidth="3" strokeLinecap="round" opacity=".28" />
			</svg>
		</span>
	);
}

function Heap({ className, name, role }: { className: string; name: string; role: string }) {
	return (
		<div className={`paper heap ${className}`}>
			<div className="heap-top">
				<b>{name}</b>
				<span>{role}</span>
			</div>
			<div className="bars">
				{Array.from({ length: 7 }, (_, i) => (
					<i key={i} />
				))}
			</div>
		</div>
	);
}

const SHORTLIST_ROWS = [
	{ rank: 2, name: "Kenji Tanaka", role: "iOS Developer · Tokyo", score: 71 },
	{ rank: 3, name: "Lucas Becker", role: "Swift Developer · Berlin", score: 54 },
	{ rank: 4, name: "Amelia Nguyen", role: "Mobile Engineer · Melbourne", score: 50, dim: true },
];

export function Hero() {
	const fit = useFitScale();
	const { section, stage } = usePointerDrift();

	return (
		<section className="hero" id="top" aria-labelledby="hero-h" ref={section}>
			<div className="wrap">
				<div className="hero-copy">
					<p className="eyebrow">CV screening for small hiring teams</p>
					<h1 id="hero-h">
						<span>
							We read{" "}
							<span className="mk sweep hl-pen" style={vars({ "--d": ".35s" })}>
								every CV.
								<Pen />
							</span>
						</span>
						<span>
							You meet the{" "}
							<span className="mk sweep" style={vars({ "--d": "1.45s" })}>
								best ones.
							</span>
						</span>
					</h1>
					<p className="lede">
						Post a job and share one link. LucidHire reads every application against your requirements,
						marks what matches and what's missing, and keeps a single ranked shortlist with the evidence
						behind every score.
					</p>
					<div className="cta-row">
						<SignUpCta className="btn">
							Post a job free <ArrowRight />
						</SignUpCta>
						<a className="link-arrow" href="#story">
							Watch it read a CV <ArrowDown />
						</a>
					</div>
					<ul className="facts">
						<li>
							<Tick />
							Free for 10 CVs a job
						</li>
						<li>
							<Tick />
							No card needed
						</li>
						<li>
							<Tick />
							Candidates apply without an account
						</li>
					</ul>
				</div>

				<div className="hero-stage" ref={stage}>
					<Swipe className="swipe" />
					<div
						className="fit art"
						ref={fit}
						role="img"
						aria-label="A sample shortlist for a Senior iOS Engineer job with all 7 CVs read. Grace Turner is first with 93: SwiftUI, Instruments and accessibility found, Kotlin Multiplatform missing. Kenji Tanaka is second with 71 and Lucas Becker third with 54."
					>
						<div className="board-in">
							<Heap className="s1" name="Kenji Tanaka" role="iOS Developer · Tokyo" />
							<Heap className="s2" name="Lucas Becker" role="Swift Developer · Berlin" />
							<div className="slist">
								<div className="sl-head">
									<div>
										<span className="sl-kicker">Shortlist</span>
										<b>Senior iOS Engineer</b>
									</div>
									<div className="sl-read">
										<span>7 of 7 read</span>
										<span className="seg">
											{Array.from({ length: 7 }, (_, n) => (
												<i key={n} style={vars({ "--n": n })} />
											))}
										</span>
									</div>
								</div>
								<div className="sl-cols">
									<span>#</span>
									<span>Candidate</span>
									<span>Match</span>
								</div>
								<div className="sl-top">
									<div className="sl-band">
										<span className="sl-rk">1</span>
										<div className="sl-who">
											<b>Grace Turner</b>
											<small>Senior iOS Engineer · London</small>
										</div>
										<div className="big-score num">
											93
											<svg viewBox="0 0 160 130" preserveAspectRatio="none" aria-hidden="true">
												<path className="ring draw" style={vars({ "--d": "2.1s" })} pathLength="1" d={RING_PATH} />
											</svg>
										</div>
									</div>
									<p className="sl-ev">
										<span className="mk sweep" style={vars({ "--d": "2.35s" })}>
											SwiftUI
										</span>
										<span className="mk sweep" style={vars({ "--d": "2.5s" })}>
											Instruments
										</span>
										<span className="mk sweep" style={vars({ "--d": "2.65s" })}>
											Accessibility
										</span>
										<span className="mk mk-gap sweep" style={vars({ "--d": "2.8s" })}>
											✕ Kotlin MP
										</span>
									</p>
								</div>
								{SHORTLIST_ROWS.map((row) => (
									<div key={row.rank} className={row.dim ? "sl-row dim" : "sl-row"}>
										<span className="sl-rk">{row.rank}</span>
										<div className="sl-who">
											<b>{row.name}</b>
											<small>{row.role}</small>
										</div>
										<span className="sl-v num">{row.score}</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
