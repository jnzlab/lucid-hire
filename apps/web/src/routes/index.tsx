import { Show } from "@clerk/react";
import { createFileRoute } from "@tanstack/react-router";
import { ApiStatus } from "../components/api-status.tsx";
import { SessionCheck } from "../components/session-check.tsx";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<section
			aria-labelledby="home-heading"
			className="mx-auto max-w-[1280px] px-[clamp(16px,4vw,56px)] py-[clamp(56px,7vw,104px)]"
		>
			<p className="font-mono text-xs tracking-[0.08em] text-ink-muted uppercase">
				CV screening for small hiring teams
			</p>
			<h1
				id="home-heading"
				className="mt-4 max-w-[14ch] font-display text-[clamp(40px,5vw,78px)] leading-[0.95] font-[830] tracking-[-0.04em] text-balance [font-stretch:112%]"
			>
				We read <span className="mk">every CV.</span>
			</h1>
			<p className="mt-6 max-w-[52ch] text-[clamp(17px,1.45vw,20px)] leading-[1.55] text-ink-2">
				LucidHire marks what matches and what's missing in every CV, and hands you one ranked
				shortlist with the evidence behind every score. The new LucidHire is being built here, one
				tested step at a time.
			</p>
			<div className="mt-10 flex flex-col items-start gap-4">
				<ApiStatus />
				<Show when="signed-in">
					<SessionCheck />
				</Show>
			</div>
		</section>
	);
}
