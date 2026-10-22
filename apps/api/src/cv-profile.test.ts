import { describe, expect, it } from "vitest";
import { cleanEmail, cleanPhone, cleanUrl, isEmptyProfile, tidyProfile } from "./cv-profile.ts";

describe("cleanEmail", () => {
	it("lower-cases and trims an address, and drops mailto:", () => {
		expect(cleanEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
		expect(cleanEmail("mailto:ada@example.com")).toBe("ada@example.com");
	});

	it("drops anything that isn't one plain address", () => {
		for (const bad of ["", "ada", "ada@", "@example.com", "ada@example", "a b@example.com", "a@b.com, c@d.com", "<a@b.com>", 42, null, {}]) {
			expect(cleanEmail(bad)).toBeUndefined();
		}
		expect(cleanEmail(`${"a".repeat(250)}@example.com`)).toBeUndefined();
	});
});

describe("cleanPhone", () => {
	it("keeps a phone number as written", () => {
		expect(cleanPhone("+44 (0)20 7946 0958")).toBe("+44 (0)20 7946 0958");
	});

	it("drops text, and numbers that are too short or too long", () => {
		for (const bad of ["call me", "123", "1".repeat(20), "+44 7946 0958 ext <b>", 5]) expect(cleanPhone(bad)).toBeUndefined();
	});
});

describe("cleanUrl", () => {
	it("keeps http and https links, and adds https to a bare domain", () => {
		expect(cleanUrl("https://github.com/ada")).toBe("https://github.com/ada");
		expect(cleanUrl("http://example.com")).toBe("http://example.com/");
		expect(cleanUrl("linkedin.com/in/ada")).toBe("https://linkedin.com/in/ada");
	});

	it("drops every other scheme, credentials, spaces and junk", () => {
		for (const bad of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"data:text/html,x",
			"file:///etc/passwd",
			"ftp://example.com",
			"mailto:ada@example.com",
			"https://user:pass@example.com",
			"https://localhost",
			"not a url",
			"ada@example.com",
			"",
			null,
			{ url: 1 },
		]) {
			expect(cleanUrl(bad)).toBeUndefined();
		}
	});
});

describe("tidyProfile", () => {
	it("turns blanks into absent fields and keeps the rest", () => {
		const profile = tidyProfile({
			email: "",
			phone: "+44 7946 095 800",
			location: " London ",
			links: [{ label: "", url: "https://github.com/ada" }],
			skills: ["Swift", "swift", " ", "SwiftUI"],
			experience: [{ title: "Engineer", company: "", start: "2019", end: "", summary: "" }, { title: "" }],
			education: [{ qualification: "BSc Maths", institution: "UCL", year: "" }],
			certifications: ["AWS SAA"],
		});
		expect(profile).toEqual({
			phone: "+44 7946 095 800",
			location: "London",
			links: [{ url: "https://github.com/ada" }],
			skills: ["Swift", "SwiftUI"],
			experience: [{ title: "Engineer", start: "2019" }],
			education: [{ qualification: "BSc Maths", institution: "UCL" }],
			certifications: ["AWS SAA"],
		});
	});

	it("survives values of the wrong type", () => {
		const empty = { links: [], skills: [], experience: [], education: [], certifications: [] };
		for (const input of [null, undefined, "x", 3, [], { links: "x", skills: 4, experience: [null, 1, "a"], education: {}, certifications: [{}] }]) {
			expect(tidyProfile(input)).toEqual(empty);
		}
	});

	it("caps the lists and the length of every string", () => {
		const profile = tidyProfile({
			links: Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i}` })),
			skills: Array.from({ length: 50 }, (_, i) => `s${i}`),
			experience: Array.from({ length: 20 }, () => ({ title: "T".repeat(500), summary: "S".repeat(900) })),
			education: Array.from({ length: 20 }, () => ({ qualification: "Q" })),
			certifications: Array.from({ length: 20 }, (_, i) => `c${i}`),
		});
		expect(profile.links).toHaveLength(10);
		expect(profile.skills).toHaveLength(30);
		expect(profile.experience).toHaveLength(10);
		expect(profile.experience[0].title).toHaveLength(100);
		expect(profile.experience[0].summary).toHaveLength(300);
		expect(profile.education).toHaveLength(6);
		expect(profile.certifications).toHaveLength(10);
	});

	it("knows when nothing was found", () => {
		expect(isEmptyProfile(tidyProfile({}))).toBe(true);
		expect(isEmptyProfile(tidyProfile({ skills: ["Swift"] }))).toBe(false);
	});
});
