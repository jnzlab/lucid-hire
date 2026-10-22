import { Show } from "@clerk/react";
import { ApiStatus } from "../components/api-status.tsx";
import { Logo } from "../components/logo.tsx";
import { SessionCheck } from "../components/session-check.tsx";
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
					<a href="#try">Try it</a>
					<a href="#pricing">Pricing</a>
					<a href="#faq">FAQ</a>
					<Show when="signed-out">
						<SignInLink />
					</Show>
				</nav>
				<div className="foot-status">
					<ApiStatus />
					<Show when="signed-in">
						<SessionCheck />
					</Show>
				</div>
				<small>© 2026 LucidHire. The candidates on this page are fictional samples.</small>
			</div>
		</footer>
	);
}
