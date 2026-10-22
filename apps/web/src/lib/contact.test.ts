import { describe, expect, it } from "vitest";
import { gmailComposeUrl, isWebLink, linkText, telHref } from "./contact.ts";

describe("linkText", () => {
	it("shows the host and the path, without the scheme, www, query or trailing slash", () => {
		expect(linkText("https://www.github.com/ada-l/?tab=repos")).toBe("github.com/ada-l");
		expect(linkText("https://ada.dev/")).toBe("ada.dev");
		expect(linkText("not a url")).toBe("not a url");
	});
});

describe("isWebLink", () => {
	it("allows http and https only", () => {
		expect(isWebLink("https://github.com/ada")).toBe(true);
		expect(isWebLink("http://example.com")).toBe(true);
		for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.com", "ftp://x.com", "//x.com", ""]) {
			expect(isWebLink(bad)).toBe(false);
		}
	});
});

describe("telHref", () => {
	it("keeps the digits and the leading plus", () => {
		expect(telHref("+44 (0)20 7946-0958")).toBe("tel:+4402079460958");
	});
});

describe("gmailComposeUrl", () => {
	it("opens a Gmail draft with the subject, a greeting by first name and the company's signature", () => {
		const url = new URL(
			gmailComposeUrl({ to: "ada@example.com", candidateName: "Ada Lovelace", jobTitle: "iOS Engineer", companyName: "Sprite Labs" }),
		);
		expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
		expect(url.searchParams.get("view")).toBe("cm");
		expect(url.searchParams.get("fs")).toBe("1");
		expect(url.searchParams.get("to")).toBe("ada@example.com");
		expect(url.searchParams.get("su")).toBe("Next steps — iOS Engineer");
		const body = url.searchParams.get("body") ?? "";
		expect(body.startsWith("Hi Ada,\n")).toBe(true);
		expect(body).toContain("the iOS Engineer role at Sprite Labs");
		expect(body.endsWith("Best,\nSprite Labs")).toBe(true);
		expect(url.href).not.toContain("+");
	});

	it("encodes what a job title or company could smuggle in, and greets without a name", () => {
		const href = gmailComposeUrl({ to: "a@b.co", candidateName: null, jobTitle: "Dev & Ops #1", companyName: "R&D" });
		const url = new URL(href);
		expect(url.searchParams.get("su")).toBe("Next steps — Dev & Ops #1");
		expect(url.searchParams.get("body")?.startsWith("Hello,")).toBe(true);
		expect([...url.searchParams.keys()]).toEqual(["view", "fs", "to", "su", "body"]);
	});
});
