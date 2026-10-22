import { z } from "zod";
import type { CandidateProfile } from "./db/schema.ts";

// What Gemini returns about the candidate. Missing facts come back as empty strings and empty lists, which keeps
// the schema simple for the model; tidyProfile turns them into absent fields.
const text = (description: string) => z.string().describe(description);

const profileShape = z.object({
	email: text("The candidate's own email address as written on the CV, or an empty string"),
	phone: text("The candidate's phone number as written on the CV, or an empty string"),
	location: text('City and country as written on the CV, like "London, UK", or an empty string'),
	links: z
		.array(
			z.object({
				label: text('What the link is, like "LinkedIn" or "Portfolio", or an empty string'),
				url: text("The full URL exactly as written on the CV"),
			}),
		)
		.describe("Profile and portfolio links printed on the CV, at most 10"),
	skills: z.array(z.string()).describe("Skills the CV lists or clearly shows, one or two words each, at most 30"),
	experience: z
		.array(
			z.object({
				title: text("Job title"),
				company: text("Employer, or an empty string"),
				start: text('Start as written, like "Mar 2021", or an empty string'),
				end: text('End as written, like "Present", or an empty string'),
				summary: text("One plain sentence on what they did there, or an empty string"),
			}),
		)
		.describe("Roles, most recent first, at most 10"),
	education: z
		.array(
			z.object({
				qualification: text('Degree or course, like "BSc Computer Science"'),
				institution: text("School or university, or an empty string"),
				year: text("Year or years as written, or an empty string"),
			}),
		)
		.describe("At most 6"),
	certifications: z.array(z.string()).describe("Certifications or licences, at most 10"),
});

// A profile the model got wrong must not cost the score: a malformed one reads as an empty one.
const EMPTY: z.infer<typeof profileShape> = {
	email: "",
	phone: "",
	location: "",
	links: [],
	skills: [],
	experience: [],
	education: [],
	certifications: [],
};
export const cvProfileSchema = profileShape.catch(EMPTY);

const MAX = { skills: 30, experience: 10, education: 6, certifications: 10, links: 10 };

const clip = (value: unknown, max: number): string | undefined => {
	if (typeof value !== "string") return undefined;
	const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
	return clean || undefined;
};

// Keeps the strings that are left, without repeats (ignoring case) and without exceeding `limit`.
function list(values: unknown, limit: number, max: number): string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const value of values) {
		const item = clip(value, max);
		if (!item || seen.has(item.toLowerCase())) continue;
		seen.add(item.toLowerCase());
		kept.push(item);
		if (kept.length === limit) break;
	}
	return kept;
}

// Not a full RFC 5322 check: plain ASCII addresses only, which keeps out anything that is not one address (and,
// in a mailto: link, anything that could add a header or a query).
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function cleanEmail(value: unknown): string | undefined {
	const email = clip(value, 254)?.replace(/^mailto:/i, "").toLowerCase();
	return email && EMAIL.test(email) ? email : undefined;
}

// Digits and the usual separators only, with enough digits to be a number.
export function cleanPhone(value: unknown): string | undefined {
	const phone = clip(value, 30);
	if (!phone || !/^\+?[\d\s().-]+$/.test(phone)) return undefined;
	const digits = phone.replace(/\D/g, "").length;
	return digits >= 7 && digits <= 15 ? phone : undefined;
}

// Only web links survive: javascript:, data:, file: and the like are dropped. A bare "linkedin.com/in/ada" gets https.
export function cleanUrl(value: unknown): string | undefined {
	let raw = clip(value, 300);
	if (!raw || /\s/.test(raw)) return undefined;
	if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) {
		if (!/^[a-z\d-]+(\.[a-z\d-]+)+(\/\S*)?$/i.test(raw)) return undefined;
		raw = `https://${raw}`;
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		if (url.username || url.password || !url.hostname.includes(".")) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

const present = <T extends object>(fields: T): T =>
	Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;

// Cleans what the model returned, so what we store (and show, and put in a CSV) is bounded and safe. The input is
// untrusted: it comes from a CV, so every field is checked as if it could be anything.
export function tidyProfile(input: unknown): CandidateProfile {
	const raw: Record<string, unknown> = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const array = (value: unknown): Record<string, unknown>[] =>
		Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];

	const seenLinks = new Set<string>();
	const links: CandidateProfile["links"] = [];
	for (const link of array(raw.links)) {
		const url = cleanUrl(link.url);
		if (!url || seenLinks.has(url)) continue;
		seenLinks.add(url);
		links.push(present({ label: clip(link.label, 40), url }));
		if (links.length === MAX.links) break;
	}

	const experience = array(raw.experience)
		.flatMap((role) => {
			const title = clip(role.title, 100);
			return title
				? [
						present({
							title,
							company: clip(role.company, 100),
							start: clip(role.start, 30),
							end: clip(role.end, 30),
							summary: clip(role.summary, 300),
						}),
					]
				: [];
		})
		.slice(0, MAX.experience);

	const education = array(raw.education)
		.flatMap((entry) => {
			const qualification = clip(entry.qualification, 120);
			return qualification
				? [present({ qualification, institution: clip(entry.institution, 120), year: clip(entry.year, 30) })]
				: [];
		})
		.slice(0, MAX.education);

	return present({
		email: cleanEmail(raw.email),
		phone: cleanPhone(raw.phone),
		location: clip(raw.location, 100),
		links,
		skills: list(raw.skills, MAX.skills, 60),
		experience,
		education,
		certifications: list(raw.certifications, MAX.certifications, 120),
	});
}

export const isEmptyProfile = (profile: CandidateProfile) =>
	!profile.email &&
	!profile.phone &&
	!profile.location &&
	profile.links.length + profile.skills.length + profile.experience.length + profile.education.length + profile.certifications.length === 0;
