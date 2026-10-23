// The "Brief check" beside the job editor: a few quick reads of the description that say whether it gives the AI
// (and candidates) what they need. It's advice, worked out in the browser as the recruiter types; nothing is sent
// and nothing is blocked by it.

export type BriefCheckKey = "duties" | "mustHaves" | "niceToHaves" | "location" | "length";
export type BriefCheck = { key: BriefCheckKey; label: string; met: boolean; hint: string };

// Below this a description rarely names enough to score CVs against.
export const BRIEF_MIN_LENGTH = 400;

// Straight and curly apostrophes, as people type them on different keyboards.
const A = "['’]";
const DUTIES = new RegExp(
	`\\b(you${A}ll|you will|you${A}d|you would|you${A}re going to|responsibilit(y|ies)|duties|day[\\s-]to[\\s-]day|in this role|the role|your role|your job|your work|what you${A}ll do)\\b`,
	"i",
);
const MUST = new RegExp(
	`\\b(must|musts|needs?|needed|requires?|required|requirements?|essentials?|qualifications?|you bring|you have|you${A}ll bring|looking for|skills)\\b`,
	"i",
);
const NICE = new RegExp(
	`\\b(nice[\\s-]to[\\s-]haves?|bonus|bonuses|a plus|plus points?|would be (great|nice|a plus)|preferred|desirable|ideally|good to have|extra credit)\\b`,
	"i",
);
const LOCATION =
	/\b(remote|remotely|hybrid|on[\s-]?site|in[\s-]office|office|offices|in[\s-]person|relocat\w*|locations?|located|based in|based out of|time[\s-]?zones?|work from home|wfh|anywhere in|commute|visa)\b/i;
// Time zones are written in capitals; matching them case-sensitively keeps "est" in "test" out.
const TIME_ZONE = /\b(UTC|GMT|CET|CEST|EST|EDT|PST|PDT|BST|IST|AEST)\b/;

const BULLET = /^\s*([-*+•]|\d+[.)])\s+\S/;
// A Markdown heading, or a line in bold on its own.
const isHeading = (line: string) => /^\s{0,3}#{1,6}\s+\S/.test(line) || /^\s*(\*\*|__)[^*_]+(\*\*|__):?\s*$/.test(line);

// Met when a heading says what's needed ("## Requirements", "**Must have**"), or when any line that does ("What you
// need:") is followed by at least three bullet points. A "nice to have" line doesn't count, however it's worded.
function listsMustHaves(lines: string[]): boolean {
	return lines.some((line, index) => {
		if (!MUST.test(line) || NICE.test(line)) return false;
		if (isHeading(line)) return true;
		let bullets = 0;
		for (const next of lines.slice(index + 1)) {
			if (!next.trim()) continue;
			if (!BULLET.test(next)) break;
			bullets += 1;
		}
		return bullets >= 3;
	});
}

// Every check, in the order the card lists them.
export function checkBrief(description: string): BriefCheck[] {
	const text = description.trim();
	const lines = text.split(/\r?\n/);
	const remaining = Math.max(0, BRIEF_MIN_LENGTH - text.length);
	return [
		{
			key: "duties",
			label: "Says what they'll do",
			met: DUTIES.test(text),
			hint: "Describe the work: what they'll build, run or fix.",
		},
		{
			key: "mustHaves",
			label: "Lists must-have skills",
			met: listsMustHaves(lines),
			hint: "Add a “Must have” heading, or list at least 3 things they need.",
		},
		{
			key: "niceToHaves",
			label: "Mentions nice-to-haves",
			met: NICE.test(text),
			hint: "Say what would be a plus, so near misses still rank well.",
		},
		{
			key: "location",
			label: "Gives a location or remote policy",
			met: LOCATION.test(text) || TIME_ZONE.test(text),
			hint: "Say where they'll work: remote, hybrid or an office, and where.",
		},
		{
			key: "length",
			label: `At least ${BRIEF_MIN_LENGTH} characters`,
			met: remaining === 0,
			hint: `${remaining} more ${remaining === 1 ? "character" : "characters"} to go.`,
		},
	];
}
