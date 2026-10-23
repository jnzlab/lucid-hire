import { ClerkFailed, ClerkLoading } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "../components/logo.tsx";

type AuthLayoutProps = {
	// A label, or the sign-up step rail.
	eyebrow: ReactNode;
	title: ReactNode;
	lede: string;
	// A line under the lede, such as the plan picked on the pricing section.
	note?: ReactNode;
	headerAside?: ReactNode;
	// Sample data on the desk showing what the heading promises (see stages.tsx).
	stage?: ReactNode;
	// The form, on the paper.
	children: ReactNode;
};

// Sign-in, sign-up, onboarding and sign-out: the form alone on the paper on the left, and the desk on the right with
// the heading and a stage that shows the product doing what the heading says. Below 900px it is one column: the
// heading, the form straight after it, then the stage on its own strip of desk.
export function AuthLayout({ eyebrow, title, lede, note, headerAside, stage, children }: AuthLayoutProps) {
	return (
		<div className="flex min-h-dvh flex-col bg-paper">
			<a className="skip" href="#main">
				Skip to content
			</a>
			<header className="app-hdr">
				<div className="wrap max-w-none justify-between">
					<Link to="/" aria-label="LucidHire home" className="rounded-[3px]">
						<Logo />
					</Link>
					{headerAside}
				</div>
			</header>
			<main
				id="main"
				className="flex flex-1 scroll-mt-22 flex-col min-[901px]:grid min-[901px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
			>
				{/* One box on the desktop desk; below 900px its two parts slot in around the form. */}
				<div className="desk contents min-[901px]:col-start-2 min-[901px]:row-start-1 min-[901px]:flex min-[901px]:flex-col min-[901px]:items-center min-[901px]:justify-center min-[901px]:gap-10 min-[901px]:px-[clamp(32px,5vw,80px)] min-[901px]:py-14">
					<section className="wrap order-1 flex w-full flex-col gap-4 pt-8 min-[901px]:order-none min-[901px]:max-w-[480px] min-[901px]:p-0">
						{typeof eyebrow === "string" ? (
							<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{eyebrow}</p>
						) : (
							eyebrow
						)}
						<h1 className="font-display text-[clamp(32px,3.7vw,54px)] leading-[.98] font-[820] tracking-[-0.038em] text-balance [font-stretch:112%]">
							{title}
						</h1>
						<p className="max-w-[46ch] text-[clamp(17px,1.35vw,19px)] leading-[1.55] text-ink-2">{lede}</p>
						{note}
					</section>
					{stage && (
						<div className="desk order-3 flex justify-center px-4 pt-10 pb-12 min-[901px]:order-none min-[901px]:w-full min-[901px]:max-w-[480px] min-[901px]:bg-transparent min-[901px]:bg-none min-[901px]:p-0">
							{stage}
						</div>
					)}
				</div>
				<div className="order-2 flex justify-center px-4 pt-7 pb-10 min-[901px]:order-none min-[901px]:col-start-1 min-[901px]:row-start-1 min-[901px]:items-center min-[901px]:px-[clamp(24px,4vw,64px)] min-[901px]:py-14">
					{children}
				</div>
			</main>
		</div>
	);
}

// Clerk's sign-in and sign-up pages are splat routes, since Clerk adds its own steps under them.
export function AuthAsideLink({ prompt, to, label }: { prompt: string; to: "/sign-in/$" | "/sign-up/$"; label: string }) {
	return (
		<p className="text-[15px] text-ink-2">
			<span className="max-[560px]:hidden">{prompt} </span>
			<Link to={to} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-[.18em]">
				{label}
			</Link>
		</p>
	);
}

// Sign-up is two steps, the account and then the company, shown on the step rail (design system §4): done steps
// have an ink-2 top border, the current one an ink border and a marked label, and the next one a line border.
export function SignUpSteps({ current }: { current: 1 | 2 }) {
	return (
		<ol aria-label={`Sign-up, step ${current} of 2`} className="grid w-full max-w-[380px] grid-cols-2 gap-2">
			{["Your account", "Your company"].map((label, index) => {
				const step = index + 1;
				const done = step < current;
				const isCurrent = step === current;
				return (
					<li
						key={label}
						aria-current={isCurrent ? "step" : undefined}
						className={`border-t-4 pt-2.5 font-mono text-[12px] leading-[1.4] tracking-[.08em] uppercase ${isCurrent ? "border-ink text-ink" : done ? "border-ink-2 text-ink-muted" : "border-line text-ink-muted"}`}
					>
						{isCurrent ? <span className="mk">{label}</span> : `${done ? "✓ " : ""}${label}`}
					</li>
				);
			})}
		</ol>
	);
}

// Clerk's form appears once its script has loaded. Until then the paper shows the form's outline (`fields` inputs)
// instead of nothing, and if the script can't load it says what to do.
export function ClerkFormStates({ fields }: { fields: number }) {
	return (
		<>
			<ClerkLoading>
				<div role="status" aria-label="Loading the form" className="flex w-full max-w-[400px] flex-col gap-2.5">
					<i className="h-8 w-3/4 rounded-[4px] bg-line-2" />
					<i className="mb-5 h-4 w-1/2 rounded-[4px] bg-line-2" />
					<i className="mb-5 h-11 rounded-md bg-line-2" />
					{Array.from({ length: fields }, (_, index) => (
						<i key={index} className="mb-3 h-11 rounded-md bg-line-2" />
					))}
					<i className="mt-2 h-11 rounded-md bg-line" />
				</div>
			</ClerkLoading>
			<ClerkFailed>
				<div role="alert" className="w-full max-w-[400px]">
					<h2 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
						The form didn't load
					</h2>
					<p className="mt-3 text-[15px] text-ink-2">
						Check your connection, or pause any blocker for this site, then reload the page.
					</p>
					<button type="button" className="btn mt-5" onClick={() => window.location.reload()}>
						Reload the page
					</button>
				</div>
			</ClerkFailed>
		</>
	);
}
