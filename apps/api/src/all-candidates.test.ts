import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { type Db, getDb } from "./db/client.ts";
import { candidates, interviewQuestions, jobs, members } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let orgId: string;
let acmeId: string;

// Tokens are "t:<userId>" in these tests.
const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};
const app = createApp({ verifySession: verify });

const at = (iso: string) => new Date(iso);

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	bucket = testD1.cvs;
	env = { CLERK_SECRET_KEY: "x", GOOGLE_GENERATIVE_AI_API_KEY: "x", DB: testD1.d1, CVS: testD1.cvs } as unknown as Env;
	db = getDb(testD1.d1);

	// Sprite Labs: an admin and a member. Acme: a second company whose candidates Sprite Labs must never reach.
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
	await db.insert(members).values({ orgId, userId: "user_member", role: "member" });
	acmeId = (await createOrgForUser(db, "user_acme", "Acme")).org.id;

	const job = (id: string, org: string, title: string, status: "open" | "closed" = "open") =>
		db.insert(jobs).values({ id, orgId: org, title, description: "d", status, createdBy: "u" });
	await job("j_ios", orgId, "iOS Engineer");
	await job("j_data", orgId, "Data Analyst");
	await job("j_old", orgId, "Archive Role", "closed");
	await job("j_acme", acmeId, "iOS Engineer");

	await cv("c_ada", "j_ios", {
		name: "Ada Lovelace",
		headline: "Swift lead",
		email: "ada@example.com",
		status: "scored",
		score: 92,
		note: "Strong",
		createdAt: at("2026-10-01T10:00:00Z"),
		scoredAt: at("2026-10-01T10:01:00Z"),
	});
	await cv("c_bob", "j_ios", {
		name: "bob stone",
		profile: { email: "bob@cv.example", links: [], skills: [], experience: [], education: [], certifications: [] },
		status: "scored",
		score: 70,
		decision: "shortlisted",
		createdAt: at("2026-10-02T10:00:00Z"),
		scoredAt: at("2026-10-02T10:01:00Z"),
	});
	// Ties with Bob on 70 but was scored first, so ranks above him.
	await cv("c_cat", "j_data", {
		name: "Cat",
		headline: "SQL_expert, 100% remote",
		status: "scored",
		score: 70,
		decision: "rejected",
		createdAt: at("2026-10-03T10:00:00Z"),
		scoredAt: at("2026-10-01T09:00:00Z"),
	});
	await cv("c_dan", "j_data", { fileName: "dan-cv.pdf", status: "queued", createdAt: at("2026-10-04T10:00:00Z") });
	// Uploaded before Dan, but failed CVs come after the ones still being read.
	await cv("c_eve", "j_old", {
		name: "Eve",
		source: "apply",
		email: "eve@apply.example",
		status: "failed",
		createdAt: at("2026-09-30T10:00:00Z"),
	});
	await cv("c_fin", "j_data", {
		name: "Fin",
		status: "scored",
		score: 45,
		createdAt: at("2026-10-06T10:00:00Z"),
		scoredAt: at("2026-10-06T10:01:00Z"),
	});
	await cv("c_spy", "j_acme", { orgId: acmeId, name: "Ada Spy", status: "scored", score: 99, scoredAt: at("2026-10-07T10:00:00Z") });
});

afterAll(() => dispose());

function cv(id: string, jobId: string, fields: Partial<typeof candidates.$inferInsert> = {}) {
	return db.insert(candidates).values({
		id,
		orgId,
		jobId,
		fileKey: `files/${id}.pdf`,
		fileName: `${id}.pdf`,
		fileSize: 1,
		createdBy: "u",
		...fields,
	});
}

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

type Row = { id: string; [key: string]: unknown };
type List = {
	candidates: Row[];
	total: number;
	page: number;
	pageSize: number;
	counts: { all: number; review: number; shortlisted: number; rejected: number; undecided: number };
};

async function list(query = "", user = "user_member") {
	const res = await call(user, "GET", `/candidates${query}`);
	expect(res.status, query).toBe(200);
	return (await res.json()) as List;
}
const ids = (result: List) => result.candidates.map((row) => row.id);

describe("GET /candidates", () => {
	it("needs a session and a company", async () => {
		expect((await call(null, "GET", "/candidates")).status).toBe(401);
		const res = await call("user_new", "GET", "/candidates");
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: { code: "no_org" } });
	});

	it("lists every job's candidates like a job's list: best score first, then CVs being read, then failed ones, uncached", async () => {
		const res = await call("user_member", "GET", "/candidates");
		expect(res.headers.get("cache-control")).toBe("no-store");
		const result = (await res.json()) as List;
		expect(ids(result)).toEqual(["c_ada", "c_cat", "c_bob", "c_fin", "c_dan", "c_eve"]);
		expect(result).toMatchObject({ total: 6, page: 1, pageSize: 50 });
		expect(result.counts).toEqual({ all: 6, review: 2, shortlisted: 1, rejected: 1, undecided: 4 });
	});

	it("sends each row with its job, never a rank", async () => {
		const [ada, bob] = (await list()).candidates.filter((row) => row.id === "c_ada" || row.id === "c_bob");
		expect(ada).toEqual({
			id: "c_ada",
			jobId: "j_ios",
			jobTitle: "iOS Engineer",
			name: "Ada Lovelace",
			fileName: "c_ada.pdf",
			headline: "Swift lead",
			email: "ada@example.com",
			score: 92,
			status: "scored",
			decision: "undecided",
			source: "upload",
			hasNote: true,
			createdAt: "2026-10-01T10:00:00.000Z",
			scoredAt: "2026-10-01T10:01:00.000Z",
		});
		// The address on the CV stands in when the applicant gave none.
		expect(bob).toMatchObject({ email: "bob@cv.example", hasNote: false });
	});

	it("searches the name, either email, the headline and the file name, taking % and _ literally", async () => {
		expect(ids(await list("?q=ADA"))).toEqual(["c_ada"]);
		expect(ids(await list("?q=bob%40cv"))).toEqual(["c_bob"]);
		expect(ids(await list("?q=apply.example"))).toEqual(["c_eve"]);
		expect(ids(await list("?q=swift"))).toEqual(["c_ada"]);
		expect(ids(await list("?q=dan-cv"))).toEqual(["c_dan"]);
		expect(ids(await list("?q=100%25"))).toEqual(["c_cat"]);
		expect(ids(await list("?q=sql_"))).toEqual(["c_cat"]);
		expect((await list("?q=%20%20")).total).toBe(6);
		expect(await list("?q=nobody-like-this")).toMatchObject({ candidates: [], total: 0 });
	});

	it("filters by job, decision, status and minimum score", async () => {
		expect(ids(await list("?jobId=j_data"))).toEqual(["c_cat", "c_fin", "c_dan"]);
		expect(ids(await list("?decision=review"))).toEqual(["c_ada", "c_fin"]);
		expect(ids(await list("?decision=shortlisted"))).toEqual(["c_bob"]);
		expect(ids(await list("?decision=rejected"))).toEqual(["c_cat"]);
		expect(ids(await list("?decision=undecided"))).toEqual(["c_ada", "c_fin", "c_dan", "c_eve"]);
		expect(ids(await list("?status=scored"))).toEqual(["c_ada", "c_cat", "c_bob", "c_fin"]);
		expect(ids(await list("?status=reading"))).toEqual(["c_dan"]);
		expect(ids(await list("?status=failed"))).toEqual(["c_eve"]);
		expect(ids(await list("?minScore=70"))).toEqual(["c_ada", "c_cat", "c_bob"]);
		expect((await list("?minScore=0")).total).toBe(6);
		expect(ids(await list("?jobId="))).toHaveLength(6);
	});

	it("counts each decision for the other filters, and totals the chosen one", async () => {
		const data = await list("?jobId=j_data&decision=review");
		expect(ids(data)).toEqual(["c_fin"]);
		expect(data.total).toBe(1);
		expect(data.counts).toEqual({ all: 3, review: 1, shortlisted: 0, rejected: 1, undecided: 2 });
		expect((await list("?minScore=70&decision=all")).counts).toEqual({ all: 3, review: 1, shortlisted: 1, rejected: 1, undecided: 1 });
		expect((await list("?status=failed&decision=shortlisted")).counts).toEqual({
			all: 1,
			review: 0,
			shortlisted: 0,
			rejected: 0,
			undecided: 1,
		});
	});

	it("sorts by newest, by name (the file name standing in, ignoring case) and by job", async () => {
		expect(ids(await list("?sort=newest"))).toEqual(["c_fin", "c_dan", "c_cat", "c_bob", "c_ada", "c_eve"]);
		expect(ids(await list("?sort=name"))).toEqual(["c_ada", "c_bob", "c_cat", "c_dan", "c_eve", "c_fin"]);
		expect(ids(await list("?sort=job"))).toEqual(["c_eve", "c_cat", "c_fin", "c_dan", "c_ada", "c_bob"]);
	});

	it("never shows another company's candidates", async () => {
		expect(ids(await list("?q=ada"))).toEqual(["c_ada"]);
		expect(await list("?jobId=j_acme")).toMatchObject({ candidates: [], total: 0, counts: { all: 0 } });
		const acme = await list("", "user_acme");
		expect(ids(acme)).toEqual(["c_spy"]);
		expect(acme.counts.all).toBe(1);
	});

	it("rejects a query it can't read, in the usual error shape", async () => {
		const bad = ["?decision=maybe", "?status=done", "?minScore=101", "?minScore=-1", "?minScore=abc", "?minScore=1.5", "?sort=rank", "?page=0", `?q=${"a".repeat(101)}`];
		for (const query of bad) {
			const res = await call("user_member", "GET", `/candidates${query}`);
			expect(res.status, query).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
	});
});

describe("GET /candidates pages", () => {
	beforeAll(async () => {
		const pagerId = (await createOrgForUser(db, "user_pager", "Pager Co")).org.id;
		for (let i = 1; i <= 8; i++) {
			await db.insert(jobs).values({ id: `pager_${i}`, orgId: pagerId, title: `Pager role ${i}`, description: "d", createdBy: "u" });
		}
		// One insert a row: D1 binds at most 100 values a statement.
		const [first, ...rest] = Array.from({ length: 55 }, (_, i) =>
			db.insert(candidates).values({
				id: `pat_${String(i).padStart(2, "0")}`,
				orgId: pagerId,
				jobId: "pager_1",
				fileKey: `pat${i}`,
				fileName: "cv.pdf",
				fileSize: 1,
				name: `Pat ${i}`,
				status: "scored",
				score: 50,
				createdBy: "u",
				createdAt: at("2026-10-10T10:00:00Z"),
			}),
		);
		await db.batch([first, ...rest]);
	});

	it("pages 50 at a time without repeating or skipping a candidate", async () => {
		const first = await list("", "user_pager");
		const second = await list("?page=2", "user_pager");
		const third = await list("?page=3", "user_pager");
		expect(first).toMatchObject({ total: 55, page: 1, pageSize: 50 });
		expect(first.candidates).toHaveLength(50);
		expect(second).toMatchObject({ total: 55, page: 2 });
		expect(second.candidates).toHaveLength(5);
		expect(third).toMatchObject({ candidates: [], total: 55, page: 3 });
		expect(new Set([...ids(first), ...ids(second)]).size).toBe(55);
	});

	it("searches at most six jobs and six candidates at a time", async () => {
		const res = await call("user_pager", "GET", "/search?q=pa");
		const found = (await res.json()) as { jobs: unknown[]; candidates: unknown[] };
		expect(found.jobs).toHaveLength(6);
		expect(found.candidates).toHaveLength(6);
	});
});

describe("GET /search", () => {
	type Found = { jobs: Row[]; candidates: Row[] };
	async function search(q: string, user = "user_member") {
		const res = await call(user, "GET", `/search?q=${encodeURIComponent(q)}`);
		expect(res.status, q).toBe(200);
		return (await res.json()) as Found;
	}

	it("needs a session and a company", async () => {
		expect((await call(null, "GET", "/search?q=ada")).status).toBe(401);
		expect((await call("user_new", "GET", "/search?q=ada")).status).toBe(403);
	});

	it("finds jobs by title, a title starting with the text first", async () => {
		const found = await search("a");
		expect(found.jobs.map((job) => job.title)).toEqual(["Archive Role", "Data Analyst"]);
		expect(found.jobs[0]).toEqual({ id: "j_old", title: "Archive Role", status: "closed", cvCount: 0 });
	});

	it("finds candidates by name, email, headline or file name, with their job, score and decision", async () => {
		const found = await search("ad");
		expect(found.candidates).toEqual([
			{
				id: "c_ada",
				jobId: "j_ios",
				jobTitle: "iOS Engineer",
				name: "Ada Lovelace",
				fileName: "c_ada.pdf",
				headline: "Swift lead",
				score: 92,
				decision: "undecided",
			},
		]);
		expect((await search("bob@cv")).candidates.map((c) => c.id)).toEqual(["c_bob"]);
		expect((await search("dan-cv")).candidates.map((c) => c.id)).toEqual(["c_dan"]);
		expect((await search("100%")).candidates.map((c) => c.id)).toEqual(["c_cat"]);
		// Trimmed, and a name starting with the text comes before a better score that only contains it.
		expect((await search("  e  ")).candidates[0].id).toBe("c_eve");
	});

	it("never finds another company's jobs or candidates", async () => {
		expect((await search("spy")).candidates).toEqual([]);
		const acme = await search("ada", "user_acme");
		expect(acme.candidates.map((c) => c.id)).toEqual(["c_spy"]);
		expect((await search("archive", "user_acme")).jobs).toEqual([]);
	});

	it("refuses a missing, blank or over-long search (400)", async () => {
		for (const query of ["", "?q=", "?q=%20%20", `?q=${"a".repeat(101)}`]) {
			const res = await call("user_member", "GET", `/search${query}`);
			expect(res.status, query).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
	});
});

describe("bulk actions", () => {
	let bulkId: string;
	const row = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];

	beforeAll(async () => {
		bulkId = (await createOrgForUser(db, "user_bulk_admin", "Bulk Co")).org.id;
		await db.insert(members).values({ orgId: bulkId, userId: "user_bulk_member", role: "member" });
		for (const id of ["b_one", "b_two"]) {
			await db.insert(jobs).values({ id, orgId: bulkId, title: id, description: "d", status: "open", cvCount: 3, createdBy: "u" });
		}
		const bcv = (id: string, jobId: string, fields: Partial<typeof candidates.$inferInsert> = {}) =>
			cv(id, jobId, { orgId: bulkId, updatedAt: at("2026-10-01T00:00:00Z"), ...fields });
		await bcv("b1", "b_one", { status: "scored", score: 80 });
		await bcv("b2", "b_one", { status: "scored", score: 60, decision: "shortlisted", decidedAt: at("2026-10-05T00:00:00Z"), decidedBy: "user_someone" });
		await bcv("b3", "b_two", { status: "failed", decision: "rejected", decidedAt: at("2026-10-06T00:00:00Z"), decidedBy: "user_someone" });
		await bcv("b4", "b_two", { status: "queued" });
		for (const id of ["d1", "d2", "d3"]) {
			await bcv(id, "b_one", { status: "scored", score: 50 });
			await bucket.put(`files/${id}.pdf`, "pdf");
		}
		await bucket.put("files/c_spy.pdf", "pdf");
	});

	describe("POST /candidates/decisions", () => {
		const decide = (user: string | null, body: unknown) => call(user, "POST", "/candidates/decisions", body);

		it("decides many CVs across jobs for any member, returning what changed and what it was", async () => {
			const res = await decide("user_bulk_member", { ids: ["b3", "b1", "b2", "c_spy", "missing"], decision: "shortlisted" });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				updated: [
					{ id: "b3", jobId: "b_two", decision: "shortlisted", previous: "rejected" },
					{ id: "b1", jobId: "b_one", decision: "shortlisted", previous: "undecided" },
				],
			});
			const b1 = await row("b1");
			expect(b1).toMatchObject({ decision: "shortlisted", decidedBy: "user_bulk_member" });
			expect(b1.decidedAt).not.toBeNull();
			// Scoring runs are timed from updated_at, so a decision leaves it alone.
			expect(b1.updatedAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
			// Already shortlisted: untouched, so who decided and when stay.
			expect(await row("b2")).toMatchObject({ decidedBy: "user_someone", decidedAt: at("2026-10-05T00:00:00Z") });
			// Another company's CV is skipped, not refused.
			expect(await row("c_spy")).toMatchObject({ decision: "undecided", decidedBy: null });
		});

		it("clears who decided and when on undecided, so an undo can put the old decisions back", async () => {
			const res = await decide("user_bulk_admin", { ids: ["b1", "b3"], decision: "undecided" });
			expect(await res.json()).toEqual({
				updated: [
					{ id: "b1", jobId: "b_one", decision: "undecided", previous: "shortlisted" },
					{ id: "b3", jobId: "b_two", decision: "undecided", previous: "shortlisted" },
				],
			});
			expect(await row("b1")).toMatchObject({ decision: "undecided", decidedAt: null, decidedBy: null });
			// Nothing left to change: nothing comes back.
			expect(await (await decide("user_bulk_admin", { ids: ["b1", "b3"], decision: "undecided" })).json()).toEqual({ updated: [] });
		});

		it("takes 200 ids in one go, more than D1 binds in one statement", async () => {
			const many = ["b4", ...Array.from({ length: 199 }, (_, i) => `nope_${i}`)];
			const res = await decide("user_bulk_member", { ids: many, decision: "rejected" });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ updated: [{ id: "b4", jobId: "b_two", decision: "rejected", previous: "undecided" }] });
		});

		it("refuses an empty, over-long or repeated list and an unknown decision (400 invalid_input)", async () => {
			const bodies = [
				{ ids: [], decision: "shortlisted" },
				{ ids: Array.from({ length: 201 }, (_, i) => `x${i}`), decision: "shortlisted" },
				{ ids: ["b1", "b1"], decision: "shortlisted" },
				{ ids: "b1", decision: "shortlisted" },
				{ ids: [1], decision: "shortlisted" },
				{ ids: [""], decision: "shortlisted" },
				{ ids: ["b1"] },
				{ ids: ["b1"], decision: "maybe" },
			];
			for (const body of bodies) {
				const res = await decide("user_bulk_member", body);
				expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
				expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
			}
			expect((await decide("user_bulk_member", "not json")).status).toBe(400);
			expect((await row("b1")).decision).toBe("undecided");
		});

		it("needs a session and a company", async () => {
			expect((await decide(null, { ids: ["b1"], decision: "shortlisted" })).status).toBe(401);
			expect((await decide("user_new", { ids: ["b1"], decision: "shortlisted" })).status).toBe(403);
		});
	});

	describe("POST /candidates/delete", () => {
		const remove = (user: string | null, body: unknown) => call(user, "POST", "/candidates/delete", body);
		const stored = async (key: string) => (await bucket.head(key)) !== null;

		it("is for admins only, whatever the body, and deletes nothing for a member", async () => {
			for (const body of [{ ids: ["d1"] }, { ids: [] }]) {
				const res = await remove("user_bulk_member", body);
				expect(res.status).toBe(403);
				expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
			}
			expect(await row("d1")).toBeDefined();
			expect(await stored("files/d1.pdf")).toBe(true);
		});

		it("deletes the company's CVs, their files and their interview questions, and the jobs keep their slots", async () => {
			await db.insert(interviewQuestions).values({
				candidateId: "d1",
				orgId: bulkId,
				jobId: "b_one",
				questions: [{ question: "Why?", focus: "fit" }],
				createdBy: "u",
			});
			const res = await remove("user_bulk_admin", { ids: ["d1", "c_spy", "d2", "missing"] });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				deleted: [
					{ id: "d1", jobId: "b_one" },
					{ id: "d2", jobId: "b_one" },
				],
			});
			expect(await db.select().from(candidates).where(inArray(candidates.id, ["d1", "d2"]))).toEqual([]);
			expect(await stored("files/d1.pdf")).toBe(false);
			expect(await stored("files/d2.pdf")).toBe(false);
			expect(await db.select().from(interviewQuestions).where(eq(interviewQuestions.candidateId, "d1"))).toEqual([]);
			expect((await db.select().from(jobs).where(eq(jobs.id, "b_one")))[0].cvCount).toBe(3);
			// Another company's CV and file are left alone.
			expect(await row("c_spy")).toBeDefined();
			expect(await stored("files/c_spy.pdf")).toBe(true);
			expect(await stored("files/d3.pdf")).toBe(true);
			// Deleting again finds nothing.
			expect(await (await remove("user_bulk_admin", { ids: ["d1", "d2"] })).json()).toEqual({ deleted: [] });
		});

		it("refuses an empty, over-long or repeated list (400 invalid_input)", async () => {
			for (const body of [{ ids: [] }, { ids: Array.from({ length: 201 }, (_, i) => `x${i}`) }, { ids: ["d3", "d3"] }, {}]) {
				const res = await remove("user_bulk_admin", body);
				expect(res.status).toBe(400);
				expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
			}
			expect(await row("d3")).toBeDefined();
		});

		it("needs a session and a company", async () => {
			expect((await remove(null, { ids: ["d3"] })).status).toBe(401);
			expect((await remove("user_new", { ids: ["d3"] })).status).toBe(403);
		});
	});
});
