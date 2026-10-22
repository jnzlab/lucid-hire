import { META_DESCRIPTION_MAX, summarise } from "../src/lib/job-summary.ts";
import { APEX_HOST } from "./redirect.ts";

const ORIGIN = `https://${APEX_HOST}`;
export const DEFAULT_OG_IMAGE = `${ORIGIN}/og-image.png`;
const API_TIMEOUT_MS = 2000;

export type JobMetaSource = { slug: string; title: string; description: string; company: string; hasCover: boolean };

export type JobMeta = { title: string; description: string; url: string; image: string };

// The address of a job's public page: `/jobs/<slug>` and nothing deeper.
export function jobSlugFromPath(pathname: string): string | null {
	return /^\/jobs\/([A-Za-z0-9-]{1,100})\/?$/.exec(pathname)?.[1] ?? null;
}

export function buildJobMeta(job: JobMetaSource, apiOrigin: string): JobMeta {
	const description = summarise(job.description, META_DESCRIPTION_MAX) || `${job.title} at ${job.company}`;
	return {
		title: `${job.title} | LucidHire`,
		description,
		url: `${ORIGIN}/jobs/${job.slug}`,
		image: job.hasCover ? `${apiOrigin}/public/jobs/${job.slug}/cover` : DEFAULT_OG_IMAGE,
	};
}

export const escapeAttr = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The tags the page's own HTML doesn't carry per job, added at the end of <head>.
export function extraTags(meta: JobMeta): string {
	const tag = (attr: "name" | "property", key: string, value: string) =>
		`<meta ${attr}="${key}" content="${escapeAttr(value)}" />`;
	return [
		tag("property", "og:image", meta.image),
		tag("name", "twitter:card", meta.image === DEFAULT_OG_IMAGE ? "summary" : "summary_large_image"),
		tag("name", "twitter:title", meta.title),
		tag("name", "twitter:description", meta.description),
		tag("name", "twitter:image", meta.image),
	].join("\n");
}

// Where the API lives for the host that served the page: localhost in dev, production everywhere else.
export const apiOriginFor = (hostname: string) =>
	hostname === "localhost" || hostname === "127.0.0.1" ? "http://localhost:8787" : "https://api.lucidhire.io";

// Fetches the job and rewrites the SPA shell with its title, description and share image. Any failure (unknown or
// draft job, API down, slow) returns the untouched page, so the app still loads.
export async function withJobMeta(page: Response, slug: string, apiOrigin: string): Promise<Response> {
	if (!page.ok || !page.headers.get("content-type")?.includes("text/html")) return page;
	let job: JobMetaSource;
	try {
		const res = await fetch(`${apiOrigin}/public/jobs/${slug}`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
		if (!res.ok) return page;
		job = ((await res.json()) as { job: JobMetaSource }).job;
	} catch {
		return page;
	}

	const meta = buildJobMeta(job, apiOrigin);
	const set = (attr: string, value: string) => ({
		element: (el: Element) => void el.setAttribute(attr, value),
	});
	return new HTMLRewriter()
		.on("title", { element: (el) => void el.setInnerContent(meta.title) })
		.on('meta[name="description"]', set("content", meta.description))
		.on('meta[property="og:title"]', set("content", meta.title))
		.on('meta[property="og:description"]', set("content", meta.description))
		.on('meta[property="og:url"]', set("content", meta.url))
		.on('link[rel="canonical"]', set("href", meta.url))
		// The page's own copies of the tags added below are dropped, so none appears twice.
		.on(
			'meta[property="og:image"], meta[property^="og:image:"], meta[name^="twitter:"]',
			{ element: (el) => void el.remove() },
		)
		.on("head", { element: (el) => void el.append(extraTags(meta), { html: true }) })
		.transform(page);
}
