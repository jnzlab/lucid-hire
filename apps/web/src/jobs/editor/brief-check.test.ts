import { describe, expect, it } from "vitest";
import { BRIEF_MIN_LENGTH, type BriefCheckKey, checkBrief } from "./brief-check.ts";

const met = (description: string) =>
	Object.fromEntries(checkBrief(description).map((check) => [check.key, check.met])) as Record<BriefCheckKey, boolean>;

const FULL = `## About the role

You'll own our Kubernetes platform and make deploys boring for every team.

## Must have

- 4+ years running Kubernetes in production
- Terraform
- Go or Python

## Nice to have

- Experience with Cloudflare Workers

Remote within UTC-2 to UTC+3, with a week in the London office each quarter. We're a small team that writes things
down, ships on Fridays without fear and keeps meetings short.`;

describe("checkBrief", () => {
	it("lists every check in the card's order, with words for each", () => {
		const checks = checkBrief("");
		expect(checks.map((check) => check.label)).toEqual([
			"Says what they'll do",
			"Lists must-have skills",
			"Mentions nice-to-haves",
			"Gives a location or remote policy",
			"At least 400 characters",
		]);
		expect(checks.every((check) => !check.met && check.hint.length > 0)).toBe(true);
	});

	it("ticks everything for a brief that covers it all", () => {
		expect(FULL.length).toBeGreaterThanOrEqual(BRIEF_MIN_LENGTH);
		expect(Object.values(met(FULL)).every(Boolean)).toBe(true);
	});

	it("reads the duties from you'll, responsibilities or the role, with either apostrophe", () => {
		expect(met("You’ll run the data team.").duties).toBe(true);
		expect(met("## Responsibilities\n- Ship").duties).toBe(true);
		expect(met("About the role: hands-on.").duties).toBe(true);
		expect(met("Swift, SwiftUI, 5 years.").duties).toBe(false);
	});

	it("counts must-haves from a heading, or from three bullets under a line that says what's needed", () => {
		expect(met("## Requirements").mustHaves).toBe(true);
		expect(met("**Must have**\n- Swift").mustHaves).toBe(true);
		expect(met("What you need:\n- Swift\n- SwiftUI\n- Combine").mustHaves).toBe(true);
		expect(met("We need someone who knows:\n\n- Swift\n- SwiftUI\n- Combine").mustHaves).toBe(true);
		// Two bullets under a sentence aren't a list of requirements yet.
		expect(met("We need someone who knows:\n- Swift\n- SwiftUI").mustHaves).toBe(false);
		// Bullets with no word for "needed" above them aren't either.
		expect(met("Stack:\n- Swift\n- SwiftUI\n- Combine").mustHaves).toBe(false);
		expect(met("You need 5 years of Swift.").mustHaves).toBe(false);
	});

	it("doesn't take a nice-to-have heading for the must-haves", () => {
		const nice = met("## Nice to have skills\n- dbt\n- Looker\n- Amplitude");
		expect(nice.mustHaves).toBe(false);
		expect(nice.niceToHaves).toBe(true);
	});

	it("finds nice-to-haves however they're worded", () => {
		for (const text of ["Bonus: Rust", "Kotlin is a plus", "Preferred: AWS", "Ideally you've used dbt", "Nice-to-haves below"]) {
			expect(met(text).niceToHaves, text).toBe(true);
		}
		expect(met("Swift and SwiftUI").niceToHaves).toBe(false);
	});

	it("finds a location or remote policy, and time zones only in capitals", () => {
		for (const text of ["Fully remote", "Hybrid, two days a week", "On-site in Berlin", "Based in Lisbon", "Hours overlap with CET"]) {
			expect(met(text).location, text).toBe(true);
		}
		expect(met("We test everything and ship daily").location).toBe(false);
	});

	it("counts the trimmed length and says how far off it is", () => {
		const short = checkBrief(`  ${"x".repeat(BRIEF_MIN_LENGTH - 1)}  `).find((check) => check.key === "length")!;
		expect(short.met).toBe(false);
		expect(short.hint).toBe("1 more character to go.");
		expect(checkBrief("x".repeat(100)).find((check) => check.key === "length")?.hint).toBe("300 more characters to go.");
		expect(met("x".repeat(BRIEF_MIN_LENGTH)).length).toBe(true);
	});
});
