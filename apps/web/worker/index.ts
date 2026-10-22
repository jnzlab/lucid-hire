import { env } from "cloudflare:workers";
import { withSecurityHeaders } from "./headers.ts";
import { redirectWwwToApex } from "./redirect.ts";
import { sitemapResponse } from "./sitemap.ts";

export default {
	async fetch(request) {
		const response =
			redirectWwwToApex(request) ??
			(new URL(request.url).pathname === "/sitemap.xml" ? sitemapResponse() : await env.ASSETS.fetch(request));
		return withSecurityHeaders(request, response);
	},
} satisfies ExportedHandler;
