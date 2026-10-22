import { useDocumentTitle } from "../lib/use-document-title.ts";
import { LandingFooter } from "./footer.tsx";
import { LandingHeader } from "./header.tsx";
import { Hero } from "./hero.tsx";
import "./landing.css";
import { Pricing } from "./pricing.tsx";
import { CtaBand, Faq, Features, HowItWorks, Trust } from "./sections.tsx";
import { Story } from "./story.tsx";
import { TryIt } from "./try-it.tsx";

// The public landing page: docs/design/landing-prototype.html, built as it is (design system, locked).
export function LandingPage() {
	useDocumentTitle("LucidHire: we read every CV, you meet the best ones");

	return (
		<div className="lp">
			<a className="skip" href="#main">
				Skip to content
			</a>
			<LandingHeader />
			<main id="main">
				<Hero />
				<Story />
				<TryIt />
				<HowItWorks />
				<Features />
				<Trust />
				<Pricing />
				<Faq />
				<CtaBand />
			</main>
			<LandingFooter />
		</div>
	);
}
