export const APEX_HOST = "lucidhire.io";
const WWW_HOST = `www.${APEX_HOST}`;

// Sends www.lucidhire.io visitors to the same path and query on the apex with a permanent redirect.
export function redirectWwwToApex(request: Request): Response | null {
	const url = new URL(request.url);
	if (url.hostname !== WWW_HOST) return null;

	url.hostname = APEX_HOST;
	url.protocol = "https:";
	url.port = "";
	return Response.redirect(url.toString(), 301);
}
