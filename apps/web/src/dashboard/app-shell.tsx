import { UserButton } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "../components/logo.tsx";
import type { Org } from "../lib/me.ts";

// The signed-in app's chrome: logo, the recruiter's company, and their Clerk account menu.
export function AppShell({ org, children }: { org: Org; children: ReactNode }) {
	return (
		<div className="flex min-h-dvh flex-col bg-paper">
			<a className="skip" href="#main">
				Skip to content
			</a>
			<header className="app-hdr">
				<div className="wrap">
					<Link to="/dashboard" aria-label="LucidHire dashboard" className="rounded-[3px]">
						<Logo />
					</Link>
					<p className="min-w-0 truncate border-l border-line pl-4 font-mono text-[13px] text-ink-muted max-[560px]:hidden">
						{org.name}
					</p>
					<div className="ml-auto flex items-center">
						<UserButton />
					</div>
				</div>
			</header>
			<main id="main" className="flex-1">
				{children}
			</main>
		</div>
	);
}
