import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DescriptionEnhancer, GEMINI_TEXT_MODEL } from "./ai.ts";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { aiUsage, candidates, jobs, members, usageCounters } from "./db/schema.ts";
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

beforeEach(async () => {
	// Every test starts with a fresh monthly job allowance.
	await db.delete(usageCounters);
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

describe("GET /jobs search, filter, sort and pages", () => {
	type Item = { id: string; title: string; status: string; cvCount: number; scoredCount: number };
	type List = { jobs: Item[]; total: number; page: number; pageSize: number };
	let orgId: string;
	let ids: Record<string, string>;

	async function list(query = "", user = "user_lister") {
		const res = await call(user, "GET", `/jobs${query}`);
		expect(res.status).toBe(200);
		return (await res.json()) as List;
	}
	const titles = (result: List) => result.jobs.map((job) => job.title);

	// Created in this order, one minute apart: Alpha, Bravo, charlie (lower case on purpose), Delta.
	beforeAll(async () => {
		orgId = (await createOrgForUser(db, "user_lister", "Lister Co")).org.id;
		const rows = [
			{ key: "alpha", title: "Alpha Engineer", status: "open", description: "Rust and Go services", cvCount: 3 },
			{ key: "bravo", title: "Bravo Designer", status: "draft", description: `${"x ".repeat(120)}Figma wizardry` },
			{ key: "charlie", title: "charlie analyst", status: "closed", description: "100% SQL_fluent", cvCount: 8 },
			{ key: "delta", title: "Delta Manager", status: "open", description: "People leadership", cvCount: 1 },
		];
		ids = {};
		for (const [index, row] of rows.entries()) {
			const id = crypto.randomUUID();
			ids[row.key] = id;
			await db.insert(jobs).values({
				id,
				orgId,
				title: row.title,
				description: row.description,
				status: row.status as "open",
				cvCount: row.cvCount ?? 0,
				createdBy: "user_lister",
				createdAt: new Date(Date.UTC(2026, 9, 1, 10, index)),
			});
		}
		const cv = (jobId: string, n: number, status: "scored" | "queued" | "failed") =>
			db.insert(candidates).values({
				id: crypto.randomUUID(),
				orgId,
				jobId,
				fileKey: `k${jobId}${n}`,
				fileName: "cv.pdf",
				fileSize: 1,
				status,
				createdBy: "user_lister",
			});
		await cv(ids.alpha, 1, "scored");
		await cv(ids.alpha, 2, "scored");
		await cv(ids.alpha, 3, "queued");
		await cv(ids.charlie, 1, "failed");
		// Another company's scored CV on the same job id shape must never be counted here.
		await createAs("user_acme", { title: "Alpha Engineer", description: "Acme's own" });
	});

	it("lists newest first with the total, page and page size", async () => {
		const result = await list();
		expect(titles(result)).toEqual(["Delta Manager", "charlie analyst", "Bravo Designer", "Alpha Engineer"]);
		expect(result).toMatchObject({ total: 4, page: 1, pageSize: 20 });
	});

	it("counts CVs and scored CVs for each job", async () => {
		const byTitle = Object.fromEntries((await list()).jobs.map((job) => [job.title, job]));
		expect(byTitle["Alpha Engineer"]).toMatchObject({ cvCount: 3, scoredCount: 2 });
		expect(byTitle["charlie analyst"]).toMatchObject({ cvCount: 8, scoredCount: 0 });
		expect(byTitle["Bravo Designer"]).toMatchObject({ cvCount: 0, scoredCount: 0 });
	});

	it("searches the title and the whole description, ignoring case", async () => {
		expect(titles(await list("?q=ENGINEER"))).toEqual(["Alpha Engineer"]);
		expect(titles(await list("?q=rust%20and%20go"))).toEqual(["Alpha Engineer"]);
		// This text sits past the first 180 characters of the description.
		const deep = await list("?q=figma%20wizardry");
		expect(titles(deep)).toEqual(["Bravo Designer"]);
		expect(deep.total).toBe(1);
	});

	it("takes % and _ in a search literally, and a blank search as no search", async () => {
		expect(titles(await list("?q=100%25"))).toEqual(["charlie analyst"]);
		expect(titles(await list("?q=sql_fluent"))).toEqual(["charlie analyst"]);
		expect(await list("?q=%25")).toMatchObject({ total: 1 });
		expect((await list("?q=%25%25%25")).total).toBe(0);
		expect((await list("?q=%20%20")).total).toBe(4);
		expect(await list("?q=nothing-like-this")).toMatchObject({ jobs: [], total: 0 });
	});

	it("filters by status", async () => {
		expect(titles(await list("?status=open"))).toEqual(["Delta Manager", "Alpha Engineer"]);
		expect(titles(await list("?status=draft"))).toEqual(["Bravo Designer"]);
		expect(titles(await list("?status=closed"))).toEqual(["charlie analyst"]);
		expect((await list("?status=all")).total).toBe(4);
		expect(await list("?status=open&q=manager")).toMatchObject({ total: 1 });
	});

	it("sorts newest, oldest, by title ignoring case, and by most CVs", async () => {
		expect(titles(await list("?sort=oldest"))).toEqual(["Alpha Engineer", "Bravo Designer", "charlie analyst", "Delta Manager"]);
		expect(titles(await list("?sort=title"))).toEqual(["Alpha Engineer", "Bravo Designer", "charlie analyst", "Delta Manager"]);
		expect(titles(await list("?sort=candidates"))).toEqual(["charlie analyst", "Alpha Engineer", "Delta Manager", "Bravo Designer"]);
		expect(titles(await list("?sort=newest"))).toEqual(["Delta Manager", "charlie analyst", "Bravo Designer", "Alpha Engineer"]);
	});

	it("pages 20 at a time without repeating or skipping a job", async () => {
		for (let i = 0; i < 22; i++) {
			await db.insert(jobs).values({
				id: crypto.randomUUID(),
				orgId,
				title: `Paged role ${String(i).padStart(2, "0")}`,
				description: "paging",
				createdBy: "user_lister",
				createdAt: new Date(Date.UTC(2026, 9, 2, 10, 0, 0)),
			});
		}
		const first = await list("?q=paging");
		const second = await list("?q=paging&page=2");
		const third = await list("?q=paging&page=3");
		expect(first).toMatchObject({ total: 22, page: 1, pageSize: 20 });
		expect(first.jobs).toHaveLength(20);
		expect(second).toMatchObject({ total: 22, page: 2 });
		expect(second.jobs).toHaveLength(2);
		expect(third).toMatchObject({ jobs: [], total: 22, page: 3 });
		const all = [...first.jobs, ...second.jobs].map((job) => job.id);
		expect(new Set(all).size).toBe(22);
	});

	it("never shows another company's jobs, in the list or the total", async () => {
		const acme = await list("?q=alpha", "user_acme");
		expect(acme).toMatchObject({ total: 1 });
		expect(acme.jobs[0]).toMatchObject({ cvCount: 0, scoredCount: 0 });
		expect((await list("?q=acme")).total).toBe(0);
	});

	it("rejects a query it can't read, in the usual error shape", async () => {
		for (const query of ["?sort=random", "?status=archived", "?page=0", "?page=abc", "?page=1.5", `?q=${"a".repeat(101)}`]) {
			const res = await call("user_lister", "GET", `/jobs${query}`);
			expect(res.status, query).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
	});
});

describe("POST /jobs/:id/duplicate", () => {
	it("creates a new draft with (copy) after the title, the same description and no CVs", async () => {
		const original = await createAs("user_admin", { title: "Staff Engineer", description: "Go and Rust", status: "open" });
		await db.update(jobs).set({ cvCount: 7 }).where(eq(jobs.id, original.id));
		await db.insert(candidates).values({
			id: crypto.randomUUID(),
			orgId: (await db.select().from(jobs).where(eq(jobs.id, original.id)))[0].orgId,
			jobId: original.id,
			fileKey: "k",
			fileName: "cv.pdf",
			fileSize: 1,
			createdBy: "user_admin",
		});

		const res = await call("user_member", "POST", `/jobs/${original.id}/duplicate`);
		expect(res.status).toBe(201);
		const { job } = (await res.json()) as { job: { id: string; title: string; status: string; description: string; cvCount: number } };
		expect(job).toMatchObject({ title: "Staff Engineer (copy)", status: "draft", description: "Go and Rust", cvCount: 0 });
		expect(job.id).not.toBe(original.id);

		const copyCandidates = await db.select().from(candidates).where(eq(candidates.jobId, job.id));
		expect(copyCandidates).toHaveLength(0);
		// The original is untouched.
		const after = await call("user_admin", "GET", `/jobs/${original.id}`);
		expect(await after.json()).toMatchObject({ job: { title: "Staff Engineer", status: "open", cvCount: 7 } });
	});

	it("cuts a long title so the whole title stays within 120 characters", async () => {
		const long = await createAs("user_admin", { title: `${"A".repeat(119)}B`, description: "d" });
		const { job } = (await (await call("user_admin", "POST", `/jobs/${long.id}/duplicate`)).json()) as { job: { title: string } };
		expect(job.title).toHaveLength(120);
		expect(job.title.endsWith(" (copy)")).toBe(true);

		const spaced = await createAs("user_admin", { title: `${"word ".repeat(23)}tail`, description: "d" });
		const second = (await (await call("user_admin", "POST", `/jobs/${spaced.id}/duplicate`)).json()) as { job: { title: string } };
		expect(second.job.title.length).toBeLessThanOrEqual(120);
		expect(second.job.title).not.toContain("  ");
		expect(second.job.title.endsWith(" (copy)")).toBe(true);
	});

	it("copies a copy as (copy) (copy), and a copy of a closed job is still a draft", async () => {
		const closed = await createAs("user_admin", { title: "Closed role", description: "d", status: "open" });
		await call("user_admin", "PATCH", `/jobs/${closed.id}`, { status: "closed" });
		const first = (await (await call("user_admin", "POST", `/jobs/${closed.id}/duplicate`)).json()) as { job: { id: string; status: string; title: string } };
		expect(first.job).toMatchObject({ status: "draft", title: "Closed role (copy)" });
		const second = (await (await call("user_admin", "POST", `/jobs/${first.job.id}/duplicate`)).json()) as { job: { title: string } };
		expect(second.job.title).toBe("Closed role (copy) (copy)");
	});

	it("answers 404 for another company's job and for one that doesn't exist, and needs a session and company", async () => {
		const acme = await createAs("user_acme", { title: "Acme only", description: "d" });
		const res = await call("user_admin", "POST", `/jobs/${acme.id}/duplicate`);
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
		expect((await call("user_admin", "POST", "/jobs/missing/duplicate")).status).toBe(404);
		expect((await call(null, "POST", `/jobs/${acme.id}/duplicate`)).status).toBe(401);
		expect((await call("user_new", "POST", `/jobs/${acme.id}/duplicate`)).status).toBe(403);
	});
});

describe("GET /jobs pipeline, activity and status counts", () => {
	type Item = {
		id: string;
		title: string;
		scoredCount: number;
		toReviewCount: number;
		shortlistedCount: number;
		rejectedCount: number;
		readingCount: number;
		failedCount: number;
		topScore: number | null;
		topCandidate: { id: string; name: string | null } | null;
		lastCvAt: string | null;
	};
	type List = { jobs: Item[]; total: number; counts: { all: number; open: number; draft: number; closed: number } };
	let orgId: string;

	async function list(query = "", user = "user_pipe") {
		const res = await call(user, "GET", `/jobs${query}`);
		expect(res.status).toBe(200);
		return (await res.json()) as List;
	}
	const titles = (result: List) => result.jobs.map((job) => job.title);
	const at = (iso: string) => new Date(iso);

	// Backend (open) has a bit of everything; Frontend (open) one CV to review; Designer (draft) none; Analyst (closed)
	// one being read, uploaded last of all.
	beforeAll(async () => {
		orgId = (await createOrgForUser(db, "user_pipe", "Pipeline Co")).org.id;
		const job = (id: string, title: string, status: "open" | "draft" | "closed", minute: number) =>
			db.insert(jobs).values({
				id,
				orgId,
				title,
				description: "d",
				status,
				createdBy: "user_pipe",
				createdAt: new Date(Date.UTC(2026, 9, 1, 10, minute)),
			});
		await job("p_backend", "Backend Engineer", "open", 0);
		await job("p_frontend", "Frontend Engineer", "open", 1);
		await job("p_designer", "Product Designer", "draft", 2);
		await job("p_analyst", "Data Analyst", "closed", 3);
		const cv = (id: string, jobId: string, fields: Partial<typeof candidates.$inferInsert>) =>
			db.insert(candidates).values({ id, orgId, jobId, fileKey: id, fileName: `${id}.pdf`, fileSize: 1, createdBy: "u", ...fields });
		// Ada and Bea tie on 90; Bea was scored first, so she ranks first.
		await cv("p_ada", "p_backend", { name: "Ada", status: "scored", score: 90, createdAt: at("2026-10-20T12:00:00Z"), scoredAt: at("2026-10-20T12:05:00Z") });
		await cv("p_bea", "p_backend", { name: "Bea", status: "scored", score: 90, createdAt: at("2026-10-20T12:02:00Z"), scoredAt: at("2026-10-20T12:03:00Z") });
		await cv("p_cy", "p_backend", { name: "Cy", status: "scored", score: 70, decision: "shortlisted", createdAt: at("2026-10-20T11:00:00Z"), scoredAt: at("2026-10-20T11:01:00Z") });
		await cv("p_di", "p_backend", { name: "Di", status: "scored", score: 30, decision: "rejected", createdAt: at("2026-10-20T11:30:00Z"), scoredAt: at("2026-10-20T11:31:00Z") });
		await cv("p_queued", "p_backend", { status: "queued", createdAt: at("2026-10-20T13:00:00Z") });
		// A failed CV someone rejected counts as failed and as not a fit.
		await cv("p_failed", "p_backend", { status: "failed", decision: "rejected", createdAt: at("2026-10-20T10:00:00Z") });
		await cv("p_eve", "p_frontend", { name: "Eve", status: "scored", score: 99, createdAt: at("2026-10-02T09:00:00Z"), scoredAt: at("2026-10-02T09:01:00Z") });
		await cv("p_fay", "p_analyst", { name: "Fay", status: "scoring", createdAt: at("2026-10-21T09:00:00Z") });
		// Another company's CVs must never be counted.
		const acme = await createAs("user_acme", { title: "Backend Engineer", description: "Acme's", status: "open" });
		const acmeOrg = (await db.select().from(jobs).where(eq(jobs.id, acme.id)))[0].orgId;
		await db.insert(candidates).values({
			id: "p_spy",
			orgId: acmeOrg,
			jobId: acme.id,
			fileKey: "spy",
			fileName: "spy.pdf",
			fileSize: 1,
			status: "scored",
			score: 100,
			createdBy: "u",
		});
	});

	it("gives each job its pipeline, its best scored CV by the ranking and its latest CV", async () => {
		const byTitle = Object.fromEntries((await list()).jobs.map((job) => [job.title, job]));
		expect(byTitle["Backend Engineer"]).toMatchObject({
			scoredCount: 4,
			toReviewCount: 2,
			shortlistedCount: 1,
			rejectedCount: 2,
			readingCount: 1,
			failedCount: 1,
			topScore: 90,
			topCandidate: { id: "p_bea", name: "Bea" },
			lastCvAt: "2026-10-20T13:00:00.000Z",
		});
		expect(byTitle["Frontend Engineer"]).toMatchObject({ toReviewCount: 1, topScore: 99, topCandidate: { id: "p_eve", name: "Eve" } });
		expect(byTitle["Data Analyst"]).toMatchObject({ toReviewCount: 0, readingCount: 1, topScore: null, topCandidate: null });
		expect(byTitle["Product Designer"]).toMatchObject({
			scoredCount: 0,
			toReviewCount: 0,
			shortlistedCount: 0,
			rejectedCount: 0,
			readingCount: 0,
			failedCount: 0,
			topScore: null,
			topCandidate: null,
			lastCvAt: null,
		});
	});

	it("sorts by latest CV (jobs without CVs last) and by most to review, newest breaking ties", async () => {
		expect(titles(await list("?sort=activity"))).toEqual(["Data Analyst", "Backend Engineer", "Frontend Engineer", "Product Designer"]);
		expect(titles(await list("?sort=review"))).toEqual(["Backend Engineer", "Frontend Engineer", "Data Analyst", "Product Designer"]);
	});

	it("counts jobs per status for the search, whatever the status filter", async () => {
		expect((await list()).counts).toEqual({ all: 4, open: 2, draft: 1, closed: 1 });
		const searched = await list("?q=engineer&status=closed");
		expect(searched).toMatchObject({ jobs: [], total: 0, counts: { all: 2, open: 2, draft: 0, closed: 0 } });
		expect(await list("?status=open")).toMatchObject({ total: 2, counts: { all: 4, open: 2 } });
	});

	it("never counts another company's CVs or jobs", async () => {
		const acme = await list("?q=backend", "user_acme");
		expect(acme.counts.all).toBe(1);
		expect(acme.jobs[0]).toMatchObject({ toReviewCount: 1, topCandidate: { id: "p_spy" } });
		const own = (await list("?q=backend")).jobs;
		expect(own).toHaveLength(1);
		expect(own[0].topCandidate?.id).toBe("p_bea");
	});
});
