import { describe, expect, it } from "vitest";
import { PRIVACY_MAILTO, PUBLIC_PATHS, SITE_ORIGIN, SUPPORT_MAILTO } from "./site.ts";

describe("site constants", () => {
	it("builds mailto links from the addresses", () => {
		expect(SUPPORT_MAILTO).toBe("mailto:support@lucidhire.io");
		expect(PRIVACY_MAILTO).toBe("mailto:privacy@lucidhire.io");
	});

	it("keeps the origin free of a trailing slash and the public paths rooted", () => {
		expect(SITE_ORIGIN.endsWith("/")).toBe(false);
		expect(PUBLIC_PATHS.every((path) => path.startsWith("/"))).toBe(true);
	});
});
