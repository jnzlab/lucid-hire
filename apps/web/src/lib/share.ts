import { SHARE_SUMMARY_MAX, summarise } from "./job-summary.ts";
import { publicJobUrl } from "./public-jobs.ts";

export type ShareLinks = { caption: string; mailto: string; x: string; linkedin: string; whatsapp: string; facebook: string };

// What to paste where there is no share button, such as Instagram.
export function buildCaption(title: string, summary: string, url: string): string {
	return summary ? `${title}\n\n${summary}\n\nApply here: ${url}` : `${title}\n\nApply here: ${url}`;
}

// Share intents for a job's public page. LinkedIn and Facebook build their own preview from the page's tags and
// ignore any text, so they only get the address. The description is cut to one short plain-text line first: a raw
// Markdown body made links thousands of characters long (legacy).
export function buildShareLinks(job: { title: string; description: string; slug: string }): ShareLinks {
	const url = publicJobUrl(job.slug);
	const summary = summarise(job.description, SHARE_SUMMARY_MAX);
	const caption = buildCaption(job.title, summary, url);
	const text = summary ? `${job.title} – ${summary}` : job.title;
	const encodedUrl = encodeURIComponent(url);
	return {
		caption,
		mailto: `mailto:?subject=${encodeURIComponent(job.title)}&body=${encodeURIComponent(caption)}`,
		x: `https://x.com/intent/tweet?text=${encodeURIComponent(`${text} ${url}`)}`,
		linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
		whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text} ${url}`)}`,
		facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
	};
}
