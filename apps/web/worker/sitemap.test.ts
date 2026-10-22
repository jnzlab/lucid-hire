import { describe, expect, it } from "vitest";
import { STATIC_SITEMAP_URLS, buildSitemap, sitemapResponse } from "./sitemap.ts";

describe("buildSitemap", () => {
	it("lists each address as a url entry", () => {
		const xml = buildSitemap(["https://lucidhire.io/", "https://lucidhire.io/privacy"]);

		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml).toContain("<loc>https://lucidhire.io/</loc>");
		expect(xml).toContain("<loc>https://lucidhire.io/privacy</loc>");
	});

	it("escapes characters that are special in XML", () => {
		expect(buildSitemap(["https://lucidhire.io/jobs/a?x=1&y=<2>"])).toContain(
			"<loc>https://lucidhire.io/jobs/a?x=1&amp;y=&lt;2&gt;</loc>",
		);
	});

	it("is a valid empty set with no addresses", () => {
		expect(buildSitemap([])).toContain("<urlset");
	});
});

describe("sitemapResponse", () => {
	it("serves the fixed public pages as XML", async () => {
		const res = sitemapResponse();

		expect(res.headers.get("content-type")).toContain("application/xml");
		expect(STATIC_SITEMAP_URLS).toEqual(["https://lucidhire.io/", "https://lucidhire.io/privacy", "https://lucidhire.io/terms"]);
		const body = await res.text();
		for (const url of STATIC_SITEMAP_URLS) expect(body).toContain(`<loc>${url}</loc>`);
	});

	it("serves extra addresses a caller passes, such as open jobs", async () => {
		const body = await sitemapResponse([...STATIC_SITEMAP_URLS, "https://lucidhire.io/jobs/ios-dev"]).text();

		expect(body).toContain("<loc>https://lucidhire.io/jobs/ios-dev</loc>");
	});
});
