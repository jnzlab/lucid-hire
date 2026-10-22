export const SECURITY_HEADERS: Record<string, string> = {
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

// Copies the response with the security headers on it. File names under /assets/ carry a content hash, so a
// successful response there is cached for a year unless the asset server already said how long. The body is
// passed through untouched, which keeps the Worker's CPU time out of it.
export function withSecurityHeaders(request: Request, response: Response): Response {
	const secured = new Response(response.body, response);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);

	if (response.ok && new URL(request.url).pathname.startsWith("/assets/") && !secured.headers.has("Cache-Control")) {
		secured.headers.set("Cache-Control", IMMUTABLE);
	}
	return secured;
}
