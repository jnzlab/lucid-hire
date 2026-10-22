import { env } from "cloudflare:workers";
import { redirectWwwToApex } from "./redirect.ts";

export default {
	fetch(request) {
		return redirectWwwToApex(request) ?? env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler;
