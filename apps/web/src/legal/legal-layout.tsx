import { Show } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "../components/logo.tsx";
import { LEGAL_UPDATED, SUPPORT_MAILTO } from "../lib/site.ts";

export type LegalSection = { id: string; title: string; body: ReactNode };

type LegalLayoutProps = {
	title: string;
	lede: string;
	sections: LegalSection[];
};

// Privacy and terms: a plain public page on paper, one column of about 68 characters, with a contents list
// at the top so a long page can be jumped through.
export function LegalLayout({ title, lede, sections }: LegalLayoutProps) {
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
					<Show when="signed-out">
						<Link
							to="/sign-in/$"
							className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-[.18em]"
						>
							Sign in
						</Link>
					</Show>
					<Show when="signed-in">
						<Link to="/dashboard" className="btn">
							Dashboard
						</Link>
					</Show>
				</div>
			</header>
			<main id="main" className="wrap w-full flex-1 scroll-mt-22 py-10 min-[901px]:py-16">
				<article className="mx-auto max-w-[68ch]">
					<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">
						Last updated {LEGAL_UPDATED}
					</p>
					<h1 className="mt-3 font-display text-[clamp(32px,4vw,48px)] leading-[1] font-[820] tracking-[-0.038em] text-balance [font-stretch:112%]">
						{title}
					</h1>
					<p className="mt-4 text-[clamp(17px,1.45vw,20px)] leading-[1.55] text-ink-2">{lede}</p>

					<nav aria-labelledby="contents-h" className="mt-8 rounded-xl bg-sheet p-5 shadow-card">
						<h2
							id="contents-h"
							className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase"
						>
							On this page
						</h2>
						<ol className="mt-2 flex flex-col">
							{sections.map((section, index) => (
								<li key={section.id}>
									<a
										href={`#${section.id}`}
										className="inline-flex min-h-11 items-center gap-3 text-[16px] text-ink underline-offset-[.18em] hover:underline"
									>
										<span className="font-mono text-[13px] text-ink-muted">{String(index + 1).padStart(2, "0")}</span>
										{section.title}
									</a>
								</li>
							))}
						</ol>
					</nav>

					{sections.map((section, index) => (
						<section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`} className="mt-12 scroll-mt-22">
							<h2 id={`${section.id}-h`} className="text-[24px] leading-[1.15] font-[800] tracking-[-0.02em] [font-stretch:108%]">
								<span className="mr-3 font-mono text-[14px] font-normal tracking-normal text-ink-muted">
									{String(index + 1).padStart(2, "0")}
								</span>
								{section.title}
							</h2>
							<div className="mt-4 flex flex-col gap-4 text-[17px] leading-[1.65] text-ink-2">{section.body}</div>
						</section>
					))}
				</article>
			</main>
			<LegalFooter />
		</div>
	);
}

function LegalFooter() {
	return (
		<footer className="border-t border-line py-8 text-[15px] text-ink-muted">
			<div className="wrap flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
				<nav aria-label="Footer" className="flex flex-wrap gap-x-5">
					<FooterLink to="/">Home</FooterLink>
					<FooterLink to="/privacy">Privacy</FooterLink>
					<FooterLink to="/terms">Terms</FooterLink>
					<a
						href={SUPPORT_MAILTO}
						className="inline-flex min-h-11 items-center text-ink-2 no-underline hover:underline"
					>
						Support
					</a>
				</nav>
				<small className="font-mono text-[12px] leading-[1.5]">© 2026 LucidHire</small>
			</div>
		</footer>
	);
}

function FooterLink({ to, children }: { to: "/" | "/privacy" | "/terms"; children: ReactNode }) {
	return (
		<Link to={to} className="inline-flex min-h-11 items-center text-ink-2 no-underline hover:underline">
			{children}
		</Link>
	);
}

// Body helpers, so the long text below reads as prose and not markup.
export function Bullets({ items }: { items: ReactNode[] }) {
	return (
		<ul className="flex list-disc flex-col gap-2 pl-6 marker:text-ink-faint">
			{items.map((item, index) => (
				<li key={index}>{item}</li>
			))}
		</ul>
	);
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} className="font-semibold text-ink underline underline-offset-[.18em]">
			{children}
		</a>
	);
}
