// Pure text helpers shared by the page, the share menu and the web Worker (which has no DOM), so keep imports out.

// Job descriptions are Markdown, and a meta tag or a share link wants one line of plain text.
const MARKDOWN: [RegExp, string][] = [
	[/```[\s\S]*?```/g, " "], // fenced code
	[/`([^`]*)`/g, "$1"], // inline code
	[/!\[[^\]]*\]\([^)]*\)/g, " "], // images
	[/\[([^\]]*)\]\([^)]*\)/g, "$1"], // links keep their text
	[/<[^>]+>/g, " "], // raw HTML tags
	[/^\s{0,3}#{1,6}\s+/gm, ""], // headings
	[/^\s{0,3}>\s?/gm, ""], // block quotes
	[/^\s*([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, ""], // list and task markers
	[/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, " "], // table rules
	[/^\s*([-*_]\s*){3,}$/gm, " "], // horizontal rules
	[/(\*\*|__|\*|~~)/g, ""], // emphasis
	[/\|/g, " "], // table pipes
];

export function stripMarkdown(markdown: string): string {
	let text = markdown;
	for (const [pattern, replacement] of MARKDOWN) text = text.replace(pattern, replacement);
	return text.replace(/\s+/g, " ").trim();
}

// Plain text cut at a word boundary with an ellipsis, at most `max` characters long including the ellipsis.
export function summarise(markdown: string, max: number): string {
	const text = stripMarkdown(markdown);
	if (text.length <= max) return text;
	const clipped = text.slice(0, max - 1);
	const space = clipped.lastIndexOf(" ");
	return `${(space > max * 0.6 ? clipped.slice(0, space) : clipped).trimEnd()}…`;
}

export const META_DESCRIPTION_MAX = 160;
export const SHARE_SUMMARY_MAX = 180;
