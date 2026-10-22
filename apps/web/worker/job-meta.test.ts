import { describe, expect, it } from "vitest";
import { DEFAULT_OG_IMAGE, apiOriginFor, buildJobMeta, escapeAttr, extraTags, jobSlugFromPath } from "./job-meta.ts";

const job = {
	slug: "ios-dev-abcd1234",
	title: "iOS Developer",
	description: "## About\n\nBuild **great** [apps](https://x.dev). " + "More detail. ".repeat(30),
	company: "Sprite Labs",
	hasCover: false,
};

describe("jobSlugFromPath", () => {
	it("reads the slug of a job page only", () => {
		expect(jobSlugFromPath("/jobs/ios-dev-abcd1234")).toBe("ios-dev-abcd1234");
		expect(jobSlugFromPath("/jobs/ios-dev-abcd1234/")).toBe("ios-dev-abcd1234");
		for (const path of ["/jobs", "/jobs/", "/jobs/a/b", "/dashboard/jobs/x", "/jobs/a b", "/jobs/a.js"]) {
			expect(jobSlugFromPath(path)).toBeNull();
		}
	});
});

describe("buildJobMeta", () => {
	it("builds the title, a plain 160-character description and the page address", () => {
		const meta = buildJobMeta(job, "https://api.lucidhire.io");
		expect(meta.title).toBe("iOS Developer | LucidHire");
		expect(meta.url).toBe("https://lucidhire.io/jobs/ios-dev-abcd1234");
		expect(meta.description.startsWith("About Build great apps. More detail.")).toBe(true);
		expect(meta.description.length).toBeLessThanOrEqual(160);
		expect(meta.description.endsWith("…")).toBe(true);
		expect(meta.image).toBe(DEFAULT_OG_IMAGE);
	});

	it("uses the cover as the share image when there is one", () => {
		expect(buildJobMeta({ ...job, hasCover: true }, "https://api.lucidhire.io").image).toBe(
			"https://api.lucidhire.io/public/jobs/ios-dev-abcd1234/cover",
		);
	});

	it("falls back to the role and company when the description has no text", () => {
		expect(buildJobMeta({ ...job, description: "---" }, "x").description).toBe("iOS Developer at Sprite Labs");
	});
});

describe("extraTags", () => {
	it("escapes quotes and angle brackets in every value", () => {
		const html = extraTags({ title: 'A "big" <job>', description: "a & b", url: "u", image: DEFAULT_OG_IMAGE });
		expect(html).toContain('content="A &quot;big&quot; &lt;job&gt;"');
		expect(html).toContain('content="a &amp; b"');
		expect(html).toContain('name="twitter:card" content="summary"');
		expect(escapeAttr('"<&>')).toBe("&quot;&lt;&amp;&gt;");
	});

	it("asks for a large card when the image is a cover", () => {
		expect(extraTags({ title: "t", description: "d", url: "u", image: "https://api.lucidhire.io/c" })).toContain(
			'content="summary_large_image"',
		);
	});
});

describe("apiOriginFor", () => {
	it("uses the local API in dev and production otherwise", () => {
		expect(apiOriginFor("localhost")).toBe("http://localhost:8787");
		expect(apiOriginFor("lucidhire.io")).toBe("https://api.lucidhire.io");
	});
});
