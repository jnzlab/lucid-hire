import { Check } from "../../components/icons.tsx";
import type { Requirement } from "../../lib/candidates.ts";
import { metCount } from "./requirements.ts";

// The job's requirements against the CV: must-haves first, then nice-to-haves, each with the line from the CV that
// shows it, or a note that the CV doesn't. A met requirement is a yellow chip with ✓ Met, a missing one a pink chip
// with ✕ and "Not met", so colour is never the only signal.
export function Evidence({ requirements, headingLevel }: { requirements: Requirement[]; headingLevel: 2 | 3 }) {
	const must = requirements.filter(({ importance }) => importance === "must");
	const nice = requirements.filter(({ importance }) => importance === "nice");
	return (
		<div>
			<p className="font-mono text-[12.5px] text-ink-muted">
				{[must.length > 0 && `Must-haves ${metCount(must)}`, nice.length > 0 && `Nice to have ${metCount(nice)}`]
					.filter(Boolean)
					.join(" · ")}
			</p>
			<div className="mt-3 rounded-xl bg-sheet px-6 pb-2 shadow-card max-[560px]:px-4">
				<RequirementGroup heading="Must-haves" items={must} level={headingLevel === 2 ? 3 : 4} />
				<RequirementGroup heading="Nice to have" items={nice} level={headingLevel === 2 ? 3 : 4} />
			</div>
		</div>
	);
}

function RequirementGroup({ heading, items, level }: { heading: string; items: Requirement[]; level: 3 | 4 }) {
	if (items.length === 0) return null;
	const Heading = level === 3 ? "h3" : "h4";
	return (
		<section aria-label={heading} className="border-b border-line-2 last:border-b-0">
			<Heading className="flex items-baseline justify-between gap-3 pt-5 pb-1 font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">
				<span>{heading}</span>
				<span className="tracking-normal normal-case">{metCount(items)} met</span>
			</Heading>
			<ul>
				{items.map((item, index) => (
					<li key={`${item.label}-${index}`} className="border-b border-line-2 py-4 last:border-b-0">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
							<span className={`mk font-mono text-[12px] [overflow-wrap:anywhere] ${item.met ? "" : "mk-gap"}`}>
								{item.met ? item.label : `✕ ${item.label}`}
							</span>
							<span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-muted">
								{item.met && <Check />}
								{item.met ? "Met" : "Not met"}
							</span>
						</div>
						<p className="mt-2 text-[15px] text-ink-2 [overflow-wrap:anywhere]">{item.requirement}</p>
						{!item.met ? (
							<p className="mt-2 text-[14px] text-gap-ink">Not shown in the CV</p>
						) : (
							item.evidence && (
								<blockquote className="mt-2 border-l-[3px] border-ink pl-3 text-[15px] text-ink [overflow-wrap:anywhere]">
									“{item.evidence}”
								</blockquote>
							)
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
