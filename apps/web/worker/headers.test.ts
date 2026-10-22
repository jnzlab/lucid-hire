import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "./headers.ts";

const at = (path: string) => new Request(`https://lucidhire.io${path}`);

describe("withSecurityHeaders", () => {
	it("adds every security header and keeps the body, status and other headers", async () => {
		const res = withSecurityHeaders(
			at("/"),
			new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
		);

		for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
		expect(res.headers.get("strict-transport-security")).toContain("max-age=63072000");
		expect(res.headers.get("content-type")).toBe("text/html");
		expect(await res.text()).toBe("<html></html>");
	});

	it("covers redirects, whose headers are immutable on the original", () => {
		const res = withSecurityHeaders(at("/"), Response.redirect("https://lucidhire.io/", 301));

		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://lucidhire.io/");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("caches hashed assets for a year", () => {
		const res = withSecurityHeaders(at("/assets/index-abc123.js"), new Response("js"));

		expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
	});

	it("keeps a cache policy the asset server set, and leaves other paths and errors alone", () => {
		const kept = withSecurityHeaders(
			at("/assets/a.js"),
			new Response("js", { headers: { "Cache-Control": "public, max-age=60" } }),
		);
		const page = withSecurityHeaders(at("/privacy"), new Response("page"));
		const missing = withSecurityHeaders(at("/assets/gone.js"), new Response("no", { status: 404 }));

		expect(kept.headers.get("cache-control")).toBe("public, max-age=60");
		expect(page.headers.get("cache-control")).toBeNull();
		expect(missing.headers.get("cache-control")).toBeNull();
	});
});
