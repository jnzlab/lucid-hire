import { useState } from "react";
import { PILE_STOPS, PLANS, type PlanKey, formatCount, planForPile } from "./data.ts";
import { vars } from "./dom.ts";
import { PlanCheck, SignUpCta } from "./ui.tsx";

const PLAN_CARDS: { key: PlanKey; price: string; per: string; features: string[]; cta: string }[] = [
	{
		key: "free",
		price: "$0",
		per: "no card",
		features: ["10 CVs per job", "10 jobs a month", "30 AI requests an hour", "Standard reading queue"],
		cta: "Start free",
	},
	{
		key: "pro",
		price: "$10",
		per: "a month",
		features: ["100 CVs per job", "20 jobs a month", "150 AI requests an hour", "Priority in the reading queue"],
		cta: "Choose Pro",
	},
	{
		key: "max",
		price: "$30",
		per: "a month",
		features: ["1,000 CVs per job", "Unlimited jobs", "600 AI requests an hour", "First in the reading queue"],
		cta: "Choose Max",
	},
];

const LAST_STOP = PILE_STOPS.length - 1;

export function Pricing() {
	const [stop, setStop] = useState(3);
	const pile = PILE_STOPS[stop];
	const fit = planForPile(pile);

	return (
		<section className="sec pricing" id="pricing" aria-labelledby="price-h">
			<div className="wrap">
				<div className="sec-top">
					<h2 className="sec-h" id="price-h">
						Start free. Pay when the <span className="mk mk-v">pile grows.</span>
					</h2>
					<p>
						Every plan reads every CV the same careful way. Paid plans raise the limits and move your jobs up
						the reading queue.
					</p>
				</div>
				<div className="pile">
					<div>
						<label htmlFor="pile-in">
							How many CVs does one job get?<small>Drag to size your pile</small>
						</label>
						<output htmlFor="pile-in" aria-live="polite">
							About <b>{formatCount(pile)} CVs</b> a job. <b>{PLANS[fit].name}</b> fits, {PLANS[fit].price}.
						</output>
					</div>
					<div>
						<input
							className="range"
							id="pile-in"
							type="range"
							min={0}
							max={LAST_STOP}
							step={1}
							value={stop}
							aria-valuetext={`${formatCount(pile)} CVs a job`}
							style={vars({ "--p": `${((stop / LAST_STOP) * 100).toFixed(2)}%` })}
							onChange={(e) => setStop(Number(e.target.value))}
						/>
						<div className="ticks" aria-hidden="true">
							{PILE_STOPS.map((n) => (
								<span key={n}>{n >= 1000 ? `${n / 1000}k` : n}</span>
							))}
						</div>
					</div>
				</div>
				<div className="plans">
					{PLAN_CARDS.map((plan) => {
						const isFit = plan.key === fit;
						return (
							<article key={plan.key} className={isFit ? "plan is-fit" : "plan"}>
								<span className="fit-tag">{isFit ? `Fits about ${formatCount(pile)} CVs a job` : "Fits your pile"}</span>
								<h3>
									<span className="mk">{PLANS[plan.key].name}</span>
								</h3>
								<p className="price">
									<b className="num">{plan.price}</b>
									<span>{plan.per}</span>
								</p>
								<ul>
									{plan.features.map((feature) => (
										<li key={feature}>
											<PlanCheck />
											{feature}
										</li>
									))}
								</ul>
								<SignUpCta className={plan.key === "pro" ? "btn" : "btn ghost"}>{plan.cta}</SignUpCta>
							</article>
						);
					})}
				</div>
				<p className="fine">Prices in US dollars. Billing runs through Polar.</p>
			</div>
		</section>
	);
}
