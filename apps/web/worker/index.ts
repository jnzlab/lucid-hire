import { env } from "cloudflare:workers";
import { redirectWwwToApex } from "./redirect.ts";
import { sitemapResponse } from "./sitemap.ts";

export default {
	fetch(request) {
		const redirect = redirectWwwToApex(request);
		if (redirect) return redirect;
		if (new URL(request.url).pathname === "/sitemap.xml") return sitemapResponse();
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler;
