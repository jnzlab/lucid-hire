import { PUBLIC_PATHS, SITE_ORIGIN } from "../src/lib/site.ts";

const escapeXml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// The sitemap document for absolute page addresses. Open jobs' public pages (/jobs/<slug>) are added by
// passing their addresses with the fixed ones.
export function buildSitemap(urls: readonly string[]): string {
	const entries = urls.map((url) => `\t<url><loc>${escapeXml(url)}</loc></url>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export const STATIC_SITEMAP_URLS = PUBLIC_PATHS.map((path) => (path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`));

export function sitemapResponse(urls: readonly string[] = STATIC_SITEMAP_URLS): Response {
	return new Response(buildSitemap(urls), {
		headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
	});
}

const API_TIMEOUT_MS = 2000;

// The fixed pages plus every open job's public page, read from the API. If the API is slow or down, the fixed
// pages still go out, so crawlers never get an error.
export async function sitemapWithJobs(apiOrigin: string): Promise<Response> {
	try {
		const res = await fetch(`${apiOrigin}/public/sitemap`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
		if (res.ok) {
			const { jobs } = (await res.json()) as { jobs: { slug: string }[] };
			return sitemapResponse([...STATIC_SITEMAP_URLS, ...jobs.map((job) => `${SITE_ORIGIN}/jobs/${job.slug}`)]);
		}
	} catch {
		// Fall back to the fixed pages below.
	}
	return sitemapResponse();
}
