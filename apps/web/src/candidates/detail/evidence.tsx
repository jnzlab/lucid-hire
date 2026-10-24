import type { EvidenceLevel, Weight } from "@lucid-hire/scoring";
import { Check } from "../../components/icons.tsx";
import { EvidenceKey, EvidenceSquare } from "../../jobs/workspace/evidence-squares.tsx";
import type { LegacyRequirement, RequirementEvidence } from "../../lib/candidates.ts";
import { levelCounts, metCount } from "./requirements.ts";

const GROUPS: { weight: Weight; heading: string }[] = [
	{ weight: "must", heading: "Must-haves" },
	{ weight: "nice", heading: "Nice to have" },
	{ weight: "off", heading: "Off, not counted" },
];
const LEVEL_LABEL: Record<EvidenceLevel | "unchecked", string> = {
	clear: "Clear",
	partial: "Partial",
	none: "None",
	unchecked: "Not checked",
};

// "1 of 2", with ", 1 partial" when some of the evidence is partial.
function summaryOf(items: RequirementEvidence[]) {
	const { clear, partial } = levelCounts(items);
	return partial > 0 ? `${clear}, ${partial} partial` : clear;
}

// The job's requirements against the CV, grouped by how much they count (must-haves, nice to haves, then the Off ones,
// dimmed), each in the job's order with its level and the line from the CV that shows it. Clear evidence is a yellow
// label, none a pink one with ✕; every level is also a square and a word, so colour is never the only signal.
export function Evidence({ evidence, headingLevel }: { evidence: RequirementEvidence[]; headingLevel: 2 | 3 }) {
	const must = evidence.filter(({ weight }) => weight === "must");
	const nice = evidence.filter(({ weight }) => weight === "nice");
	return (
		<div>
			<p className="font-mono text-[12.5px] text-ink-muted">
				{[must.length > 0 && `Must-haves ${summaryOf(must)}`, nice.length > 0 && `Nice to have ${summaryOf(nice)}`]
					.filter(Boolean)
					.join(" · ")}
			</p>
			<EvidenceKey className="mt-2" />
			<div className="mt-3 rounded-xl bg-sheet px-6 pb-2 shadow-card max-[560px]:px-4">
				{GROUPS.map(({ weight, heading }) => (
					<EvidenceGroup
						key={weight}
						heading={heading}
						items={evidence.filter((item) => item.weight === weight)}
						off={weight === "off"}
						level={headingLevel === 2 ? 3 : 4}
					/>
				))}
			</div>
		</div>
	);
}

function EvidenceGroup({ heading, items, off, level }: { heading: string; items: RequirementEvidence[]; off: boolean; level: 3 | 4 }) {
	if (items.length === 0) return null;
	const Heading = level === 3 ? "h3" : "h4";
	const counts = levelCounts(items);
	return (
		<section aria-label={heading} className="border-b border-line-2 last:border-b-0">
			<Heading className="flex items-baseline justify-between gap-3 pt-5 pb-1 font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">
				<span>{heading}</span>
				<span className="tracking-normal normal-case">
					{counts.clear} clear{counts.partial > 0 && ` · ${counts.partial} partial`}
				</span>
			</Heading>
			<ul>
				{items.map((item) => (
					<EvidenceItem key={item.id} item={item} off={off} />
				))}
			</ul>
		</section>
	);
}

// An Off requirement is dimmed in colour (its marks and pink go), not faded, so its text keeps its contrast.
function EvidenceItem({ item, off }: { item: RequirementEvidence; off: boolean }) {
	const { level } = item;
	const mark = off ? "text-ink-muted" : level === "clear" ? "mk" : level === "none" ? "mk mk-gap" : "text-ink";
	return (
		<li className="border-b border-line-2 py-4 last:border-b-0">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<span className={`font-mono text-[12px] [overflow-wrap:anywhere] ${mark}`}>
					{level === "none" && !off ? `✕ ${item.label}` : item.label}
				</span>
				<span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-muted">
					<EvidenceSquare level={level} off={off} />
					{LEVEL_LABEL[level ?? "unchecked"]}
				</span>
			</div>
			<p className={`mt-2 text-[15px] [overflow-wrap:anywhere] ${off ? "text-ink-muted" : "text-ink-2"}`}>{item.detail}</p>
			{level === null ? (
				<p className="mt-2 text-[14px] text-ink-muted">Not checked yet. Check the CVs against it from the job's Requirements tab.</p>
			) : level === "none" ? (
				<p className={`mt-2 text-[14px] ${off ? "text-ink-muted" : "text-gap-ink"}`}>Not shown in the CV</p>
			) : (
				item.quote && (
					<blockquote
						className={`mt-2 border-l-[3px] pl-3 text-[15px] [overflow-wrap:anywhere] ${off ? "border-line text-ink-muted" : "border-ink text-ink"}`}
					>
						“{item.quote}”
					</blockquote>
				)
			)}
		</li>
	);
}

// What the old scorer found, for a CV scored before the job had requirements: must-haves first, then nice to haves,
// each met (a yellow chip with ✓ Met) or not (a pink chip with ✕ and "Not met").
export function LegacyEvidence({ requirements, headingLevel }: { requirements: LegacyRequirement[]; headingLevel: 2 | 3 }) {
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
				<LegacyGroup heading="Must-haves" items={must} level={headingLevel === 2 ? 3 : 4} />
				<LegacyGroup heading="Nice to have" items={nice} level={headingLevel === 2 ? 3 : 4} />
			</div>
		</div>
	);
}

function LegacyGroup({ heading, items, level }: { heading: string; items: LegacyRequirement[]; level: 3 | 4 }) {
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
