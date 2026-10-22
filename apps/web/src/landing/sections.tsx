import { useEffect, useRef, useState } from "react";
import { ArrowRight, ClaimCheck, STEP_RING_PATH, SignUpCta } from "./ui.tsx";

const JOB_LINK = "lucidhire.io/jobs/senior-ios-engineer";

function StepNumber({ n }: { n: number }) {
	return (
		<div className="how-n">
			{n}
			<svg viewBox="0 0 66 66" aria-hidden="true">
				<path className="ring" pathLength="1" d={STEP_RING_PATH} />
			</svg>
		</div>
	);
}

// Copies the sample job link, or selects it when the clipboard isn't available.
function CopyLink() {
	const [label, setLabel] = useState("Copy");
	const code = useRef<HTMLElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const flash = (text: string) => {
		setLabel(text);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setLabel("Copy"), 1600);
	};
	const select = () => {
		const range = document.createRange();
		if (!code.current) return;
		range.selectNodeContents(code.current);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		flash("Selected");
	};
	const copy = () => {
		if (!navigator.clipboard?.writeText) return select();
		navigator.clipboard.writeText(`https://${JOB_LINK}`).then(() => flash("Copied"), select);
	};

	return (
		<div className="linkbox">
			<code ref={code}>{JOB_LINK}</code>
			<button type="button" onClick={copy}>
				{label}
			</button>
		</div>
	);
}

export function HowItWorks() {
	return (
		<section className="sec how" id="how" aria-labelledby="how-h">
			<div className="wrap">
				<div className="sec-top">
					<h2 className="sec-h" id="how-h">
						Your part takes <span className="mk mk-v">three steps.</span>
					</h2>
					<p>LucidHire does the reading. You write the job, share a link and make the calls.</p>
				</div>
				<div className="how-grid">
					<div className="how-card">
						<StepNumber n={1} />
						<h3>Post the job</h3>
						<p>
							Paste it in, rough notes and all. LucidHire tidies the wording and pulls out the requirements,
							and you mark each one must-have or nice-to-have.
						</p>
						<div className="how-vis reqchips" aria-hidden="true">
							<span className="m">Swift · must</span>
							<span className="m">SwiftUI · must</span>
							<span className="m">Performance · must</span>
							<span className="m">Accessibility · must</span>
							<span className="n">GraphQL · nice</span>
							<span className="n">Kotlin Multiplatform · nice</span>
						</div>
					</div>
					<div className="how-card">
						<StepNumber n={2} />
						<h3>Share one link</h3>
						<p>
							Put it on your careers page, LinkedIn or a job board. Candidates upload a PDF and they're done,
							with no account to create. Got a folder of CVs already? Upload them all at once.
						</p>
						<div className="how-vis">
							<CopyLink />
						</div>
					</div>
					<div className="how-card">
						<StepNumber n={3} />
						<h3>Open the shortlist</h3>
						<p>
							Ranked by match, with the evidence and interview questions for every finalist. Shortlist or
							pass with one click.
						</p>
						<div className="how-vis mini" aria-hidden="true">
							<div>
								<i>1</i>Grace Turner<b>93</b>
							</div>
							<div>
								<i>2</i>Kenji Tanaka<b>71</b>
							</div>
							<div>
								<i>3</i>Lucas Becker<b>54</b>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

const FEATURES = [
	["Bulk upload", "Already have a folder of CVs? Drop the PDFs in and they're read and ranked with everyone else."],
	["Spam stays out", "Every application passes a Cloudflare Turnstile check before it reaches your list."],
	[
		"Questions for every finalist",
		"Interview questions aimed at each candidate's gaps, so the conversation starts where the CV stops.",
	],
	["A list that sorts itself", "New CVs slot into rank as soon as they're read. There's no spreadsheet to re-sort."],
	[
		"Usage in plain numbers",
		"CVs, jobs and AI requests are counted where you can see them, so a limit never takes you by surprise.",
	],
	["Priority reading", "On Pro and Max, your CVs move to the front of the reading queue when it's busy."],
] as const;

export function Features() {
	return (
		<section className="sec inv" aria-labelledby="feat-h">
			<div className="wrap">
				<div className="sec-top">
					<h2 className="sec-h" id="feat-h">
						The rest of the <span className="mk mk-v">kit.</span>
					</h2>
					<p>The small things that keep screening quick, for teams that don't have a recruiter on staff.</p>
				</div>
				<ul className="feat">
					{FEATURES.map(([title, body], i) => (
						<li key={title}>
							<p className="eyebrow">{String(i + 1).padStart(2, "0")}</p>
							<h3>{title}</h3>
							<p>{body}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

const CLAIMS = [
	["Every score shows its evidence.", "Each point cites the line of the CV that earned it, and the gaps are named too."],
	[
		"People make the decisions.",
		"LucidHire ranks and explains. Shortlisting or passing on someone is always a person's click.",
	],
	["Applying stays simple.", "No account and no password for candidates. A link, a PDF and a quick spam check."],
	[
		"Runs on Cloudflare.",
		"The app, the database, CV storage and the reading queue all run on Cloudflare's network. Sign-in is by Clerk and billing by Polar.",
	],
	["Tested before every release.", "A change ships only after TestSprite has run the app end to end."],
] as const;

export function Trust() {
	return (
		<section className="sec trust" aria-labelledby="trust-h">
			<div className="wrap trust-grid">
				<div>
					<h2 className="sec-h" id="trust-h">
						Built to be trusted with <span className="mk mk-v">people's CVs.</span>
					</h2>
					<p>A CV is someone's working life on two pages. These are the rules LucidHire runs by.</p>
				</div>
				<ul className="claims">
					{CLAIMS.map(([title, body]) => (
						<li key={title}>
							<ClaimCheck />
							<div>
								<b>{title}</b>
								<span>{body}</span>
							</div>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

const QUESTIONS = [
	[
		"Do candidates need an account to apply?",
		"No. They open your link, upload a PDF and pass a quick spam check. That's the whole form.",
	],
	[
		"How is the match score worked out?",
		"LucidHire reads each CV against the requirements in your job post. You see the lines it counted as evidence for each requirement, the ones it couldn't find, and how they add up to the score.",
	],
	[
		"Does LucidHire turn people down on its own?",
		"No. It ranks and explains. Every shortlist and every pass is a click by someone on your team.",
	],
	[
		"What files can candidates send?",
		"PDF, the format nearly every CV is already in. You can also bulk upload PDFs you've collected somewhere else.",
	],
	[
		"What counts toward my plan?",
		"CVs per job, jobs per month and AI requests per hour. Your dashboard shows all three as you go, so you'll see a limit coming.",
	],
	["Can I change plans later?", "Yes. Move up when a job takes off and back down when hiring goes quiet."],
] as const;

export function Faq() {
	return (
		<section className="sec faq" id="faq" aria-labelledby="faq-h">
			<div className="wrap faq-grid">
				<div>
					<h2 className="sec-h" id="faq-h">
						Questions people <span className="mk mk-v">ask first.</span>
					</h2>
					<p>Short answers. The longer version is one job post away.</p>
				</div>
				<div className="qa">
					{QUESTIONS.map(([question, answer]) => (
						<details key={question}>
							<summary>
								<span className="mk">{question}</span>
								<i className="plus" aria-hidden="true" />
							</summary>
							<p>{answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}

export function CtaBand() {
	return (
		<section className="cta-band" id="start" aria-labelledby="start-h">
			<div className="wrap">
				<h2 id="start-h">
					<span>Stop skimming.</span> <span>Start meeting people.</span>
				</h2>
				<p>Post your first job today. The free plan reads 10 CVs a job, and there's no card to enter.</p>
				<div className="cta-row">
					<SignUpCta className="btn">
						Post a job free <ArrowRight />
					</SignUpCta>
					<a className="btn ghost" href="#pricing">
						Compare plans
					</a>
				</div>
			</div>
		</section>
	);
}
