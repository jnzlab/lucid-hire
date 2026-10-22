import { describe, expect, it } from "vitest";
import { redirectWwwToApex } from "./redirect.ts";

describe("redirectWwwToApex", () => {
	it("permanently redirects www to the apex, keeping the path and query", () => {
		const res = redirectWwwToApex(new Request("https://www.lucidhire.io/jobs/ios-dev?ref=x"));

		expect(res?.status).toBe(301);
		expect(res?.headers.get("location")).toBe("https://lucidhire.io/jobs/ios-dev?ref=x");
	});

	it("upgrades a plain-http www request to https", () => {
		const res = redirectWwwToApex(new Request("http://www.lucidhire.io/"));

		expect(res?.headers.get("location")).toBe("https://lucidhire.io/");
	});

	it("leaves the apex and local hosts alone", () => {
		expect(redirectWwwToApex(new Request("https://lucidhire.io/"))).toBeNull();
		expect(redirectWwwToApex(new Request("http://localhost:5173/"))).toBeNull();
	});
});
