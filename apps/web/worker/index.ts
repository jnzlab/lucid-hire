import { env } from "cloudflare:workers";
import { withSecurityHeaders } from "./headers.ts";
import { apiOriginFor, jobSlugFromPath, withJobMeta } from "./job-meta.ts";
import { redirectWwwToApex } from "./redirect.ts";
import { sitemapResponse } from "./sitemap.ts";

async function respond(request: Request): Promise<Response> {
	const redirect = redirectWwwToApex(request);
	if (redirect) return redirect;

	const url = new URL(request.url);
	if (url.pathname === "/sitemap.xml") return sitemapResponse();

	const page = await env.ASSETS.fetch(request);
	// A job's public page gets its own title, description and share image for crawlers and link previews.
	const slug =
		request.method === "GET" && request.headers.get("accept")?.includes("text/html")
			? jobSlugFromPath(url.pathname)
			: null;
	return slug ? withJobMeta(page, slug, apiOriginFor(url.hostname)) : page;
}

export default {
	async fetch(request) {
		return withSecurityHeaders(request, await respond(request));
	},
} satisfies ExportedHandler;
