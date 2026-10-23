import { type ReactNode, useId } from "react";
import type { CandidateProfile } from "../lib/candidates.ts";
import { isWebLink, linkText, telHref } from "../lib/contact.ts";

// True when the card would have nothing to show. The email is not in it: it sits in the page header.
const isEmptyProfile = (profile: CandidateProfile | null): boolean =>
	!profile ||
	(!profile.phone &&
		!profile.location &&
		profile.links.length +
			profile.skills.length +
			profile.experience.length +
			profile.education.length +
			profile.certifications.length ===
			0);

function Group({ heading, level, children }: { heading: string; level: 3 | 4; children: ReactNode }) {
	const Heading = level === 3 ? "h3" : "h4";
	return (
		<section aria-label={heading} className="border-b border-line-2 py-4 last:border-b-0">
			<Heading className="pb-2 font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">{heading}</Heading>
			{children}
		</section>
	);
}

const dates = (start?: string, end?: string) => [start, end].filter(Boolean).join(" – ");

// What the CV itself says about the candidate: contact details, links, skills, experience, education and
// certifications. Empty sections are left out, and the whole card gives way to `fallback` when there is nothing to
// show. The CV is untrusted text, so values only ever render as text, and only http and https links are clickable.
// `headingLevel` is the card's heading (2 on the candidate page, 3 in the job page's panel); `hideHeading` keeps it
// for screen readers only, where a tab already names the card.
export function ProfileCard({
	profile,
	headingLevel = 2,
	hideHeading = false,
	fallback = null,
}: {
	profile: CandidateProfile | null;
	headingLevel?: 2 | 3;
	hideHeading?: boolean;
	fallback?: ReactNode;
}) {
	const headingId = useId();
	if (!profile || isEmptyProfile(profile)) return fallback;
	const { phone, location, links, skills, experience, education, certifications } = profile;
	const Heading = headingLevel === 2 ? "h2" : "h3";
	const level = headingLevel === 2 ? 3 : 4;

	return (
		<section aria-labelledby={headingId}>
			<div className={hideHeading ? "sr-only" : ""}>
				<Heading id={headingId} className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Profile
				</Heading>
			</div>
			<p className={`text-[13px] text-ink-muted ${hideHeading ? "" : "mt-1"}`}>As written on the CV.</p>
			<div className="mt-3 rounded-xl bg-sheet px-6 shadow-card max-[560px]:px-4">
				{(phone || location) && (
					<Group heading="Contact" level={level}>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[15px] text-ink-2">
							{phone && (
								<>
									<dt className="font-mono text-[12.5px] text-ink-muted">Phone</dt>
									<dd>
										<a href={telHref(phone)} className="underline underline-offset-[.18em]">
											{phone}
										</a>
									</dd>
								</>
							)}
							{location && (
								<>
									<dt className="font-mono text-[12.5px] text-ink-muted">Location</dt>
									<dd className="[overflow-wrap:anywhere]">{location}</dd>
								</>
							)}
						</dl>
					</Group>
				)}
				{links.length > 0 && (
					<Group heading="Links" level={level}>
						<ul className="flex flex-col gap-1.5 text-[15px]">
							{links.map((link) => (
								<li key={link.url} className="[overflow-wrap:anywhere]">
									{link.label && <span className="mr-2 font-mono text-[12.5px] text-ink-muted">{link.label}</span>}
									{isWebLink(link.url) ? (
										<a
											href={link.url}
											target="_blank"
											rel="noopener noreferrer"
											className="underline underline-offset-[.18em]"
										>
											{linkText(link.url)}
										</a>
									) : (
										<span>{link.url}</span>
									)}
								</li>
							))}
						</ul>
					</Group>
				)}
				{skills.length > 0 && (
					<Group heading="Skills" level={level}>
						<ul className="flex flex-wrap gap-x-3 gap-y-2 font-mono text-[12.5px]">
							{skills.map((skill) => (
								<li key={skill} className="rounded-md border border-line bg-paper-2 px-2 py-1 [overflow-wrap:anywhere]">
									{skill}
								</li>
							))}
						</ul>
					</Group>
				)}
				{experience.length > 0 && (
					<Group heading="Experience" level={level}>
						{/* A timeline: a rule down the left with a dot at each role, newest first as the CV lists them. */}
						<ul className="ml-1 flex flex-col gap-4 border-l border-line pl-5">
							{experience.map((role, index) => (
								<li key={`${role.title}-${index}`} className="relative">
									<span
										aria-hidden="true"
										className="absolute top-[7px] -left-[26px] size-2.5 rounded-full border-2 border-ink bg-sheet"
									/>
									<p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
										{role.title}
										{role.company && <span className="font-normal text-ink-2"> · {role.company}</span>}
									</p>
									{dates(role.start, role.end) && (
										<p className="font-mono text-[12.5px] text-ink-muted">{dates(role.start, role.end)}</p>
									)}
									{role.summary && <p className="mt-1 text-[15px] text-ink-2 [overflow-wrap:anywhere]">{role.summary}</p>}
								</li>
							))}
						</ul>
					</Group>
				)}
				{education.length > 0 && (
					<Group heading="Education" level={level}>
						<ul className="flex flex-col gap-3">
							{education.map((entry, index) => (
								<li key={`${entry.qualification}-${index}`} className="text-[15px] [overflow-wrap:anywhere]">
									<span className="font-semibold text-ink">{entry.qualification}</span>
									{entry.institution && <span className="text-ink-2"> · {entry.institution}</span>}
									{entry.year && <span className="font-mono text-[12.5px] text-ink-muted"> · {entry.year}</span>}
								</li>
							))}
						</ul>
					</Group>
				)}
				{certifications.length > 0 && (
					<Group heading="Certifications" level={level}>
						<ul className="flex flex-col gap-1.5 text-[15px] text-ink-2">
							{certifications.map((item) => (
								<li key={item} className="[overflow-wrap:anywhere]">
									{item}
								</li>
							))}
						</ul>
					</Group>
				)}
			</div>
		</section>
	);
}
