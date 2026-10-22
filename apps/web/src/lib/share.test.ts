import { describe, expect, it } from "vitest";
import { buildCaption, buildShareLinks } from "./share.ts";

const job = { title: "iOS Developer", slug: "ios-dev-abcd1234", description: "## About\n\nBuild **great** apps.\n\n- Swift" };
const url = "https://lucidhire.io/jobs/ios-dev-abcd1234";

describe("buildShareLinks", () => {
	it("builds the caption from the title, a plain summary and the link", () => {
		expect(buildShareLinks(job).caption).toBe(`iOS Developer\n\nAbout Build great apps. Swift\n\nApply here: ${url}`);
		expect(buildCaption("T", "", url)).toBe(`T\n\nApply here: ${url}`);
	});

	it("builds an intent for each network", () => {
		const links = buildShareLinks(job);
		expect(links.mailto.startsWith("mailto:?subject=iOS%20Developer&body=")).toBe(true);
		expect(decodeURIComponent(links.mailto)).toContain(`Apply here: ${url}`);
		expect(links.x.startsWith("https://x.com/intent/tweet?text=")).toBe(true);
		expect(decodeURIComponent(links.x)).toContain(url);
		expect(links.linkedin).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
		expect(links.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
		expect(decodeURIComponent(links.whatsapp)).toContain(url);
	});

	it("keeps links short for a long description", () => {
		const long = buildShareLinks({ ...job, description: "word ".repeat(5000) });
		expect(long.x.length).toBeLessThan(900);
		expect(long.caption.length).toBeLessThan(400);
	});
});
