import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, type Db } from "./db/client.ts";
import { organizations } from "./db/schema.ts";
import { createOrgForUser, findOrgForUser, normalizeOrgName } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
	const testD1 = await createTestD1();
	db = getDb(testD1.d1);
	dispose = testD1.dispose;
});

afterAll(() => dispose());

describe("normalizeOrgName", () => {
	it("trims and collapses whitespace", () => {
		expect(normalizeOrgName("  Acme   Hiring  Co ")).toBe("Acme Hiring Co");
	});

	it("rejects names that are too short, too long or not text", () => {
		expect(normalizeOrgName(" A ")).toBeNull();
		expect(normalizeOrgName("x".repeat(81))).toBeNull();
		expect(normalizeOrgName("x".repeat(80))).toBe("x".repeat(80));
		expect(normalizeOrgName(42)).toBeNull();
		expect(normalizeOrgName(undefined)).toBeNull();
	});
});

describe("createOrgForUser", () => {
	it("creates the company with the user as its admin", async () => {
		const { org, created } = await createOrgForUser(db, "user_admin", "Acme Hiring");

		expect(created).toBe(true);
		expect(org).toMatchObject({ name: "Acme Hiring", role: "admin" });
		expect(await findOrgForUser(db, "user_admin")).toEqual(org);
	});

	it("returns the existing company when onboarding runs again", async () => {
		const first = await createOrgForUser(db, "user_twice", "First Name Ltd");
		const again = await createOrgForUser(db, "user_twice", "Second Name Ltd");

		expect(again).toEqual({ org: first.org, created: false });
		expect(await db.$count(organizations, eq(organizations.createdBy, "user_twice"))).toBe(1);
	});

	it("creates only one company when two submits race", async () => {
		const results = await Promise.all([
			createOrgForUser(db, "user_race", "Race One"),
			createOrgForUser(db, "user_race", "Race Two"),
		]);

		expect(results.filter((r) => r.created)).toHaveLength(1);
		expect(results[0].org.id).toBe(results[1].org.id);
		expect(await db.$count(organizations, eq(organizations.createdBy, "user_race"))).toBe(1);
	});

	it("finds nothing for a user who hasn't onboarded", async () => {
		expect(await findOrgForUser(db, "user_new")).toBeNull();
	});
});
