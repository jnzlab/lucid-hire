import { describe, expect, it } from "vitest";
import { isEmail } from "./candidates.ts";
import { isValidEmail } from "./public-jobs.ts";

describe("the email rule shared with the API", () => {
	it("takes plain addresses, in any case", () => {
		for (const good of ["ada@example.com", "Ada.Lovelace+jobs@Mail.Example.co.uk", "a_b-c@x.io"]) {
			expect(isEmail(good)).toBe(true);
			expect(isValidEmail(good)).toBe(true);
		}
	});

	it("refuses what the API refuses: queries, lists and addresses a request header can't carry", () => {
		for (const bad of ["ada@example.com?bcc=spy%40evil.com", "ada@x.co,spy@evil.com", "a%3fb@example.com", "иван@почта.рф", "ada@example", "a b@example.com"]) {
			expect(isEmail(bad)).toBe(false);
			expect(isValidEmail(bad)).toBe(false);
		}
	});
});
