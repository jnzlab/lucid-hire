import { Show } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { ApiStatus } from "../components/api-status.tsx";
import { Logo } from "../components/logo.tsx";
import { SUPPORT_MAILTO } from "../lib/site.ts";
import { SignInLink } from "./ui.tsx";

export function LandingFooter() {
	return (
		<footer className="foot">
			<div className="wrap">
				<a className="logo" href="#top" aria-label="LucidHire, back to top">
					<Logo />
				</a>
				<nav aria-label="Footer">
					<a href="#story">The story</a>
					<a href="#how">How it works</a>
					<a href="#pricing">Pricing</a>
					<a href="#faq">FAQ</a>
					<Link to="/privacy">Privacy</Link>
					<Link to="/terms">Terms</Link>
					<a href={SUPPORT_MAILTO}>Support</a>
					<Show when="signed-out">
						<SignInLink />
					</Show>
				</nav>
				<div className="foot-status">
					<ApiStatus />
				</div>
				<small>© 2026 LucidHire. The candidates on this page are fictional samples.</small>
			</div>
		</footer>
	);
}
