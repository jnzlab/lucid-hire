import { Show, UserButton } from "@clerk/react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../components/logo.tsx";
import { SignInLink, SignUpCta } from "./ui.tsx";

export function LandingHeader() {
	const [lifted, setLifted] = useState(false);
	const progress = useRef<HTMLElement>(null);

	// The header gets its shadow once the page scrolls. Browsers without scroll-driven
	// animations get the reading progress bar from here instead of from CSS.
	useEffect(() => {
		const timeline = CSS.supports("animation-timeline: scroll()");
		let frame = 0;
		const update = () => {
			frame = 0;
			const y = window.scrollY;
			setLifted(y > 8);
			if (!timeline && progress.current) {
				const max = document.documentElement.scrollHeight - window.innerHeight;
				progress.current.style.transform = `scaleX(${(max > 0 ? Math.min(y / max, 1) : 0).toFixed(4)})`;
			}
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll);
			cancelAnimationFrame(frame);
		};
	}, []);

	return (
		<header className={lifted ? "hdr lifted" : "hdr"}>
			<div className="wrap">
				<a className="logo" href="#top" aria-label="LucidHire, back to top">
					<Logo />
				</a>
				<nav className="nav" aria-label="Main">
					<a href="#story">The story</a>
					<a href="#try" className="opt">
						Try it
					</a>
					<a href="#pricing">Pricing</a>
					<a href="#faq" className="opt">
						FAQ
					</a>
					<Show when="signed-out">
						<SignInLink />
					</Show>
				</nav>
				<Show when="signed-out">
					<SignUpCta className="btn sm">Post a job free</SignUpCta>
				</Show>
				<Show when="signed-in">
					<span className="hdr-user">
						<UserButton />
					</span>
				</Show>
			</div>
			<div className="progress" aria-hidden="true">
				<i ref={progress} />
			</div>
		</header>
	);
}
