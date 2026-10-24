import { useEffect, useRef, useState } from "react";
import {
	CANDIDATES,
	ORDINALS,
	PRESETS,
	type PresetKey,
	REQUIREMENTS,
	matchingPreset,
	rankCandidates,
	scoreCandidates,
} from "./data.ts";
import { REDUCED_MOTION, useMediaQuery, vars } from "./dom.ts";

const GRACE = 0;
const WEIGHT_OPTIONS = [
	{ value: 3, label: "Must" },
	{ value: 1, label: "Nice" },
	{ value: 0, label: "Off" },
] as const;

function ranksOf(order: number[]): number[] {
	const ranks: number[] = [];
	order.forEach((candidate, rank) => {
		ranks[candidate] = rank;
	});
	return ranks;
}

// Counts from the previous score to the new one, so a re-rank reads as a change.
function TweenedScore({ value }: { value: number }) {
	const [shown, setShown] = useState(value);
	const from = useRef(value);
	const reduce = useMediaQuery(REDUCED_MOTION);

	useEffect(() => {
		const start = from.current;
		from.current = value;
		if (reduce || start === value) {
			setShown(value);
			return;
		}
		const t0 = performance.now();
		let frame = 0;
		const step = (t: number) => {
			const p = Math.min((t - t0) / 450, 1);
			setShown(Math.round(start + (value - start) * (1 - (1 - p) ** 3)));
			if (p < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [value, reduce]);

	return <>{shown}</>;
}

export function TryIt() {
	const [weights, setWeights] = useState<number[]>([...PRESETS.posted.weights]);
	// How far each candidate moved in the last re-rank. The arrows fade out after a moment.
	const [moves, setMoves] = useState<number[]>(() => CANDIDATES.map(() => 0));
	const [showMoves, setShowMoves] = useState(false);
	const movesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	const scores = scoreCandidates(weights);
	const order = rankCandidates(scores);
	const ranks = ranksOf(order);
	const anyOn = weights.some((w) => w > 0);
	const preset = matchingPreset(weights);
	const leader = order[0];

	useEffect(() => () => clearTimeout(movesTimer.current), []);

	const apply = (next: number[]) => {
		const nextRanks = ranksOf(rankCandidates(scoreCandidates(next)));
		setMoves(ranks.map((was, c) => was - nextRanks[c]));
		setShowMoves(true);
		setWeights(next);
		clearTimeout(movesTimer.current);
		movesTimer.current = setTimeout(() => setShowMoves(false), 2400);
	};

	return (
		<section className="sec try" id="try" aria-labelledby="try-h">
			<div className="wrap">
				<div className="sec-top">
					<h2 className="sec-h" id="try-h">
						Your turn. <span className="mk mk-v">Decide what matters.</span>
					</h2>
					<p>
						Same job, same seven candidates. Mark each requirement as a must-have, a nice-to-have or off, and
						watch the list re-rank itself.
					</p>
				</div>
				<div className="lab">
					<div className="panel">
						<h3>Requirements</h3>
						<div className="presets" role="group" aria-label="Quick setups">
							{(Object.keys(PRESETS) as PresetKey[]).map((key) => (
								<button
									key={key}
									type="button"
									className="pre"
									aria-pressed={preset === key}
									onClick={() => apply([...PRESETS[key].weights])}
								>
									{PRESETS[key].label}
								</button>
							))}
						</div>
						<div className="reqs">
							{REQUIREMENTS.map((req, k) => (
								<div key={req.name} className="req">
									<div className="req-l" id={`rq${k}`}>
										{req.name}
										<small>{req.detail}</small>
									</div>
									<div className="seg" role="radiogroup" aria-labelledby={`rq${k}`}>
										{WEIGHT_OPTIONS.map((option) => (
											<label key={option.value}>
												<input
													type="radio"
													name={`w${k}`}
													value={option.value}
													checked={weights[k] === option.value}
													onChange={() => apply(weights.map((w, j) => (j === k ? option.value : w)))}
												/>
												<span>{option.label}</span>
											</label>
										))}
									</div>
								</div>
							))}
						</div>
						<p className="lab-note">
							Same rules as the app: a must-have counts three times as much as a nice-to-have, and partial
							evidence counts half. Changing them re-ranks the list at once, with no new AI read.
						</p>
					</div>

					<div className="sheet-list">
						<div className="sheet-h">
							<b>Senior iOS Engineer</b>
							<span>7 candidates · sample data</span>
						</div>
						<p className="leader" aria-live="polite">
							{anyOn ? (
								<>
									<b>{CANDIDATES[leader].name}</b> leads with {scores[leader]}.
									{ranks[GRACE] ? ` Grace is ${ORDINALS[ranks[GRACE]]}.` : ""}
								</>
							) : (
								"Turn on at least one requirement to rank the list."
							)}
						</p>
						<div className="lcols" aria-hidden="true">
							<span>#</span>
							<span>Candidate</span>
							<span className="ekey">
								{REQUIREMENTS.map((req) => (
									<span key={req.short}>{req.short}</span>
								))}
							</span>
							<span>Match</span>
						</div>
						<ol className="lrows">
							{CANDIDATES.map((candidate, c) => {
								const move = moves[c];
								const score = scores[c];
								return (
									<li
										key={candidate.name}
										className={ranks[c] === 0 && anyOn ? "lrow top" : "lrow"}
										style={vars({ "--r": ranks[c] })}
									>
										<span className="rk num">{ranks[c] + 1}</span>
										<span className="nm">
											<b className="mk">{candidate.name}</b>
											<span className={move ? `mv${showMoves ? " on" : ""} ${move > 0 ? "up" : "down"}` : "mv"}>
												{move ? `${move > 0 ? "↑" : "↓"}${Math.abs(move)}` : ""}
											</span>
											<small>{candidate.role}</small>
										</span>
										<span className="ev6" aria-hidden="true">
											{candidate.evidence.map((e, k) => {
												const level = e === 1 ? "e2" : e === 0.5 ? "e1" : "";
												const off = weights[k] === 0 ? "off" : "";
												return <i key={REQUIREMENTS[k].short} className={`${level} ${off}`.trim() || undefined} />;
											})}
										</span>
										<span className="sc num">
											<span className="v">{score === null ? "–" : <TweenedScore value={score} />}</span>
										</span>
									</li>
								);
							})}
						</ol>
						<p className="lab-note">Squares show the evidence found. Filled is clear, half is partial, empty is none.</p>
					</div>
				</div>
			</div>
		</section>
	);
}
