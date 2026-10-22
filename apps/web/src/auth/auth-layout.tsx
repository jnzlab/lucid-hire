import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Check } from "../components/icons.tsx";
import { Logo } from "../components/logo.tsx";

type AuthLayoutProps = {
	eyebrow: string;
	title: ReactNode;
	lede: string;
	points?: string[];
	headerAside?: ReactNode;
	// The form, shown as a card on the desk.
	children: ReactNode;
};

// Sign-in, sign-up and onboarding: the pitch on paper on the left, the form on the desk on the right.
// Below 900px the two stack, with the form straight after a short heading.
export function AuthLayout({ eyebrow, title, lede, points, headerAside, children }: AuthLayoutProps) {
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
			<main id="main" className="grid flex-1 scroll-mt-22 min-[901px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
				<section className="wrap flex w-full flex-col justify-center gap-4 py-8 min-[901px]:mx-0 min-[901px]:max-w-[640px] min-[901px]:py-16">
					<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{eyebrow}</p>
					<h1 className="font-display text-[clamp(32px,4vw,52px)] leading-[.98] font-[820] tracking-[-0.038em] text-balance [font-stretch:112%]">
						{title}
					</h1>
					<p className="max-w-[46ch] text-[clamp(17px,1.45vw,20px)] leading-[1.55] text-ink-2">{lede}</p>
					{points && (
						<ul className="mt-2 hidden flex-col gap-2.5 min-[901px]:flex">
							{points.map((point) => (
								<li key={point} className="flex items-center gap-2.5 text-[16px] text-ink-2">
									<span className="grid size-6 flex-none place-items-center rounded-md bg-marker text-on-marker">
										<Check />
									</span>
									{point}
								</li>
							))}
						</ul>
					)}
				</section>
				<div className="desk flex items-start justify-center px-4 py-8 min-[901px]:items-center min-[901px]:py-16">
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
