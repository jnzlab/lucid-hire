import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DescriptionEnhancer, GEMINI_TEXT_MODEL } from "./ai.ts";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, members } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let dispose: () => Promise<void>;
let allowAi: boolean;
let enhanceCalls: number;
let enhanceFails: boolean;

// Tokens are "t:<userId>" in these tests.
const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};

const enhance: DescriptionEnhancer = async (_env, { title, description }) => {
	enhanceCalls += 1;
	if (enhanceFails) throw new Error("model unavailable");
	return { value: `${title ?? "Role"}\n\nWhat you need:\n- ${description}`, inputTokens: 120, outputTokens: 80 };
};

const app = createApp({ verifySession: verify, enhanceDescription: enhance });

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		DB: testD1.d1,
		AI_RATE_LIMIT: { limit: async () => ({ success: allowAi }) },
	} as unknown as Env;
	db = getDb(testD1.d1);

	// Sprite Labs: an admin and a member. Acme: a second company whose jobs Sprite Labs must never see.
	const { org } = await createOrgForUser(db, "user_admin", "Sprite Labs");
	await db.insert(members).values({ orgId: org.id, userId: "user_member", role: "member" });
	await createOrgForUser(db, "user_acme", "Acme");
});

afterAll(() => dispose());

beforeEach(() => {
	allowAi = true;
	enhanceCalls = 0;
	enhanceFails = false;
});

// Runs a request with a fake execution context and waits for its waitUntil work.
async function call(user: string | null, method: string, path: string, body?: unknown) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const headers: Record<string, string> = user ? { authorization: `Bearer t:${user}` } : {};
	if (body !== undefined) headers["content-type"] = "application/json";
	const res = await app.request(
		path,
		{ method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) },
		env,
		ctx as unknown as ExecutionContext,
	);
	await Promise.all(pending);
	return res;
}

async function createAs(user: string, input: Record<string, unknown>) {
	const res = await call(user, "POST", "/jobs", input);
	expect(res.status).toBe(201);
	return ((await res.json()) as { job: { id: string; title: string; status: string } }).job;
}

describe("access", () => {
	it("needs a session", async () => {
		expect((await call(null, "GET", "/jobs")).status).toBe(401);
	});

	it("needs a company, so recruiters finish onboarding first", async () => {
		const res = await call("user_new", "GET", "/jobs");
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: { code: "no_org" } });
	});
});

describe("POST /jobs", () => {
	it("saves a draft by default, with the title tidied", async () => {
		const job = await createAs("user_admin", { title: "  Senior   iOS Engineer ", description: "Swift, SwiftUI" });
		expect(job).toMatchObject({ title: "Senior iOS Engineer", status: "draft", cvCount: 0 });
	});

	it("can open the job straight away, but not create it closed", async () => {
		expect(await createAs("user_admin", { title: "Data Scientist", description: "Python", status: "open" })).toMatchObject({
			status: "open",
		});
		const res = await call("user_admin", "POST", "/jobs", { title: "Closed", description: "x", status: "closed" });
		expect(res.status).toBe(400);
	});

	it("rejects a missing title and an empty description, field by field", async () => {
		const res = await call("user_admin", "POST", "/jobs", { title: "x", description: "   " });
		expect(res.status).toBe(400);
		const { error } = (await res.json()) as { error: { code: string; fields: Record<string, string> } };
		expect(error.code).toBe("invalid_input");
		expect(error.fields.title).toBe("Enter a job title between 2 and 120 characters");
		expect(error.fields.description).toMatch(/Describe the role/);
	});

	it("caps the description at 20,000 characters", async () => {
		const res = await call("user_admin", "POST", "/jobs", { title: "Long", description: "a".repeat(20_001) });
		expect(res.status).toBe(400);
	});

	it("answers malformed JSON with a 400, not a server error", async () => {
		const res = await call("user_admin", "POST", "/jobs", "{not json");
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
	});
});

describe("reading jobs", () => {
	it("lists only the company's own jobs, newest first", async () => {
		const older = await createAs("user_admin", { title: "Older role", description: "a" });
		const newer = await createAs("user_member", { title: "Newer role", description: "b" });
		await createAs("user_acme", { title: "Acme secret role", description: "c" });

		const res = await call("user_admin", "GET", "/jobs");
		const { jobs } = (await res.json()) as { jobs: { id: string; title: string }[] };
		const ids = jobs.map((job) => job.id);
		expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
		expect(jobs.map((job) => job.title)).not.toContain("Acme secret role");
		expect(jobs[0]).not.toHaveProperty("description");
	});

	it("returns one job with its description, and 404 for another company's job", async () => {
		const mine = await createAs("user_admin", { title: "Mine", description: "Kotlin" });
		const theirs = await createAs("user_acme", { title: "Theirs", description: "Go" });

		const res = await call("user_admin", "GET", `/jobs/${mine.id}`);
		expect(await res.json()).toMatchObject({ job: { title: "Mine", description: "Kotlin" } });
		expect((await call("user_admin", "GET", `/jobs/${theirs.id}`)).status).toBe(404);
	});
});

describe("PATCH /jobs/:id", () => {
	it("edits, closes and reopens a job", async () => {
		const job = await createAs("user_admin", { title: "Typo rol", description: "a", status: "open" });

		const edited = await call("user_member", "PATCH", `/jobs/${job.id}`, { title: "Typo role" });
		expect(await edited.json()).toMatchObject({ job: { title: "Typo role", status: "open" } });

		const closed = await call("user_member", "PATCH", `/jobs/${job.id}`, { status: "closed" });
		expect(await closed.json()).toMatchObject({ job: { status: "closed" } });

		const reopened = await call("user_member", "PATCH", `/jobs/${job.id}`, { status: "open" });
		expect(await reopened.json()).toMatchObject({ job: { status: "open" } });
	});

	it("rejects an empty edit and leaves other companies' jobs alone", async () => {
		const job = await createAs("user_acme", { title: "Acme role", description: "a" });
		expect((await call("user_acme", "PATCH", `/jobs/${job.id}`, {})).status).toBe(400);
		expect((await call("user_admin", "PATCH", `/jobs/${job.id}`, { title: "Hijacked" })).status).toBe(404);
	});
});

describe("DELETE /jobs/:id", () => {
	it("is for admins only (legacy B10 let any member delete)", async () => {
		const job = await createAs("user_admin", { title: "Keep me", description: "a" });
		const res = await call("user_member", "DELETE", `/jobs/${job.id}`);
		expect(res.status).toBe(403);
		expect((await call("user_admin", "GET", `/jobs/${job.id}`)).status).toBe(200);
	});

	it("deletes the job for an admin, and 404s for another company's job", async () => {
		const job = await createAs("user_admin", { title: "Delete me", description: "a" });
		expect((await call("user_admin", "DELETE", `/jobs/${job.id}`)).status).toBe(204);
		expect((await call("user_admin", "GET", `/jobs/${job.id}`)).status).toBe(404);

		const theirs = await createAs("user_acme", { title: "Acme keep", description: "a" });
		expect((await call("user_admin", "DELETE", `/jobs/${theirs.id}`)).status).toBe(404);
	});
});

describe("POST /jobs/enhance", () => {
	const usageRows = (operationUser: string) => db.select().from(aiUsage).where(eq(aiUsage.userId, operationUser));

	it("returns the rewritten description and records the call's tokens", async () => {
		const res = await call("user_admin", "POST", "/jobs/enhance", { title: "iOS Engineer", description: "Swift 5y" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ description: "iOS Engineer\n\nWhat you need:\n- Swift 5y" });

		const [row] = await usageRows("user_admin");
		expect(row).toMatchObject({
			operation: "job_description_enhance",
			model: GEMINI_TEXT_MODEL,
			ok: true,
			inputTokens: 120,
			outputTokens: 80,
		});
	});

	it("reports a model failure as 502 and still records the attempt", async () => {
		enhanceFails = true;
		const res = await call("user_member", "POST", "/jobs/enhance", { description: "Swift" });
		expect(res.status).toBe(502);
		expect(await res.json()).toMatchObject({ error: { code: "ai_unavailable" } });
		expect(await usageRows("user_member")).toMatchObject([{ ok: false }]);
	});

	it("stops at the company's rate limit without calling the model", async () => {
		allowAi = false;
		const res = await call("user_admin", "POST", "/jobs/enhance", { description: "Swift" });
		expect(res.status).toBe(429);
		expect(enhanceCalls).toBe(0);
	});

	it("validates the notes before spending anything", async () => {
		const res = await call("user_admin", "POST", "/jobs/enhance", { description: "" });
		expect(res.status).toBe(400);
		expect(enhanceCalls).toBe(0);
	});
});
