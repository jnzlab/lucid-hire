import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { CV_MAX_BYTES, NOTE_MAX, STALE_SCORING_MS, computeScore, deleteCvFiles } from "./candidates.ts";
import { type Db, getDb } from "./db/client.ts";
import { type Requirement, candidates, jobs, members } from "./db/schema.ts";
import { createOrgForUser } from "./orgs.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let orgId: string;
let acmeOrgId: string;
let failPut: boolean;
let failCreate: boolean;
let creates: { id: string; params: unknown }[];
let putBodies: unknown[];

// Tokens are "t:<userId>" in these tests.
const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};

const app = createApp({ verifySession: verify });

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	bucket = testD1.cvs;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		DB: testD1.d1,
		// The real bucket, except that a test can make writes fail. Miniflare's bucket handle can't take the
		// request's stream (workerd gives it a known length, Node doesn't), so the stream is drained here
		// after being recorded, which is what the route must hand over.
		CVS: {
			put: async (key: string, value: unknown, options: R2PutOptions) => {
				if (failPut) throw new Error("R2 is down");
				putBodies.push(value);
				const body = value instanceof ReadableStream ? await new Response(value).arrayBuffer() : (value as ArrayBuffer);
				return bucket.put(key, body, options);
			},
			get: (key: string) => bucket.get(key),
			delete: (keys: string | string[]) => bucket.delete(keys),
		},
		// Records the Workflow instances it is asked to start.
		SCORE_CV: {
			create: async (options: { id: string; params: unknown }) => {
				if (failCreate) throw new Error("Workflows is down");
				creates.push(options);
				return { id: options.id };
			},
		},
	} as unknown as Env;
	db = getDb(testD1.d1);

	// Sprite Labs: an admin and a member. Acme: a second company whose jobs and CVs Sprite Labs must never reach.
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
	await db.insert(members).values({ orgId, userId: "user_member", role: "member" });
	acmeOrgId = (await createOrgForUser(db, "user_acme", "Acme")).org.id;
});

afterAll(() => dispose());

beforeEach(() => {
	failPut = false;
	failCreate = false;
	creates = [];
	putBodies = [];
});

// Runs a request with a fake execution context and waits for its waitUntil work.
type Init = { headers?: Record<string, string>; body?: Uint8Array };

async function send(user: string | null, method: string, path: string, init: Init = {}) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const headers = { ...(user ? { authorization: `Bearer t:${user}` } : {}), ...init.headers };
	const res = await app.request(path, { method, headers, body: init.body }, env, ctx as unknown as ExecutionContext);
	await Promise.all(pending);
	return res;
}

type UploadOptions = { fileName?: string | null; type?: string; length?: string | null; body?: Uint8Array };

// Uploads a PDF the way the web app does: the raw bytes as the body, with a Content-Length.
function upload(
	user: string,
	jobId: string,
	{ fileName = "ada.pdf", type = "application/pdf", length, body = PDF }: UploadOptions = {},
) {
	const headers: Record<string, string> = { "content-type": type };
	const size = length === undefined ? String(body.byteLength) : length;
	if (size !== null) headers["content-length"] = size;
	const query = fileName === null ? "" : `?fileName=${encodeURIComponent(fileName)}`;
	return send(user, "POST", `/jobs/${jobId}/candidates${query}`, { headers, body });
}

async function createJob(status: "draft" | "open" | "closed" = "open", user = "user_admin") {
	// A job can't be created closed, so a closed one is opened first and closed straight after.
	const input = { title: "iOS Engineer", description: "Swift, SwiftUI", status: status === "closed" ? "open" : status };
	const res = await send(user, "POST", "/jobs", {
		headers: { "content-type": "application/json" },
		body: new TextEncoder().encode(JSON.stringify(input)),
	});
	const { job } = (await res.json()) as { job: { id: string } };
	if (status === "closed") await db.update(jobs).set({ status: "closed" }).where(eq(jobs.id, job.id));
	return job.id;
}

async function jobOf(jobId: string, user = "user_admin") {
	const res = await send(user, "GET", `/jobs/${jobId}`);
	return ((await res.json()) as { job: { cvCount: number; updatedAt: string } }).job;
}

type CandidateJson = {
	id: string;
	fileName: string;
	fileSize: number;
	status: string;
	score: number | null;
	rank: number | null;
	rankedCount: number;
	name: string | null;
	matches: string[];
	gaps: string[];
	error: string | null;
	canRetry: boolean;
	summary: string | null;
	requirements: Requirement[] | null;
	decision: string;
	note: string | null;
	decidedAt: string | null;
	updatedAt: string;
};

async function uploadOk(user: string, jobId: string, options?: UploadOptions) {
	const res = await upload(user, jobId, options);
	expect(res.status).toBe(201);
	return ((await res.json()) as { candidate: CandidateJson }).candidate;
}

const req = (label: string, importance: "must" | "nice", met: boolean): Requirement => ({
	label,
	requirement: `Needs ${label}`,
	importance,
	met,
	evidence: met ? `Worked with ${label}` : "",
});

// Inserts a candidate row directly, for states an upload can't produce on its own.
async function seed(jobId: string, values: Partial<typeof candidates.$inferInsert> = {}, owner = orgId) {
	const id = values.id ?? crypto.randomUUID();
	await db.insert(candidates).values({
		id,
		orgId: owner,
		jobId,
		fileKey: `${owner}/${jobId}/${id}.pdf`,
		fileName: "seed.pdf",
		fileSize: 100,
		createdBy: "user_admin",
		...values,
	});
	return id;
}

const keysUnder = async (prefix: string) => (await bucket.list({ prefix })).objects.map((o) => o.key);

describe("access", () => {
	it("needs a session and a company", async () => {
		const jobId = await createJob();
		expect((await send(null, "GET", `/jobs/${jobId}/candidates`)).status).toBe(401);
		expect((await send("user_new", "GET", `/jobs/${jobId}/candidates`)).status).toBe(403);
	});
});

describe("POST /jobs/:jobId/candidates", () => {
	it("streams the PDF into R2, queues the candidate and starts a scoring run", async () => {
		const jobId = await createJob();
		const before = await jobOf(jobId);
		await new Promise((resolve) => setTimeout(resolve, 5));

		const candidate = await uploadOk("user_member", jobId);
		expect(candidate).toMatchObject({
			fileName: "ada.pdf",
			fileSize: PDF.byteLength,
			status: "queued",
			name: null,
			score: null,
			matches: [],
			gaps: [],
			error: null,
			canRetry: false,
		});

		const key = `${orgId}/${jobId}/${candidate.id}.pdf`;
		const stored = await bucket.get(key);
		expect(new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(PDF);
		expect(stored?.httpMetadata?.contentType).toBe("application/pdf");

		// The route hands R2 the request's own stream, never a buffered copy.
		expect(putBodies).toHaveLength(1);
		expect(putBodies[0]).toBeInstanceOf(ReadableStream);

		expect(creates).toEqual([{ id: candidate.id, params: { candidateId: candidate.id } }]);
		const [row] = await db.select().from(candidates).where(eq(candidates.id, candidate.id));
		expect(row).toMatchObject({ orgId, jobId, fileKey: key, status: "queued", runs: 1, createdBy: "user_member" });

		// A new CV counts against the job, but it isn't an edit to it.
		const after = await jobOf(jobId);
		expect(after.cvCount).toBe(1);
		expect(after.updatedAt).toBe(before.updatedAt);
	});

	it("defaults the file name, keeps .pdf when it cuts a long one, and accepts exactly 5 MB", async () => {
		const jobId = await createJob();
		expect(await uploadOk("user_admin", jobId, { fileName: null })).toMatchObject({ fileName: "cv.pdf" });
		expect(await uploadOk("user_admin", jobId, { fileName: `  ${"a".repeat(300)}.PDF  ` })).toMatchObject({
			fileName: `${"a".repeat(196)}.PDF`,
		});

		const big = await uploadOk("user_admin", jobId, { body: new Uint8Array(CV_MAX_BYTES) });
		expect(big.fileSize).toBe(CV_MAX_BYTES);
		expect((await bucket.head(`${orgId}/${jobId}/${big.id}.pdf`))?.size).toBe(CV_MAX_BYTES);
	});

	it("rejects anything but a PDF with 415, before taking a slot", async () => {
		const jobId = await createJob();
		const notPdfs = [{ type: "image/png" }, { type: "text/plain" }, { fileName: "cv.docx" }, { fileName: "cv" }];
		for (const options of notPdfs) {
			const res = await upload("user_admin", jobId, options);
			expect(res.status).toBe(415);
			expect(await res.json()).toEqual({ error: { code: "not_pdf", message: "Upload a PDF file" } });
		}
		expect((await jobOf(jobId)).cvCount).toBe(0);
		expect(creates).toEqual([]);
	});

	it("needs a Content-Length (411)", async () => {
		const jobId = await createJob();
		const res = await upload("user_admin", jobId, { length: null });
		expect(res.status).toBe(411);
		expect(await res.json()).toEqual({ error: { code: "length_required", message: "Upload the file again" } });
		expect((await upload("user_admin", jobId, { length: "lots" })).status).toBe(411);
	});

	it("rejects a file over 5 MB (413) without reading its body, and an empty one (400)", async () => {
		const jobId = await createJob();
		// The Content-Length claims more than 5 MB; the route must answer from the header alone.
		const request = new Request(`http://localhost/jobs/${jobId}/candidates?fileName=big.pdf`, {
			method: "POST",
			headers: {
				authorization: "Bearer t:user_admin",
				"content-type": "application/pdf",
				"content-length": String(CV_MAX_BYTES + 1),
			},
			body: PDF,
		});
		const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
		const tooLarge = await app.request(request, undefined, env, ctx);
		expect(tooLarge.status).toBe(413);
		expect(await tooLarge.json()).toEqual({ error: { code: "too_large", message: "Each CV must be 5 MB or smaller" } });
		expect(request.bodyUsed).toBe(false);

		const empty = await upload("user_admin", jobId, { length: "0", body: new Uint8Array(0) });
		expect(empty.status).toBe(400);
		expect(await empty.json()).toEqual({ error: { code: "empty_file", message: "That file is empty" } });
		expect((await jobOf(jobId)).cvCount).toBe(0);
		expect(putBodies).toEqual([]);
	});

	it("404s for a job that doesn't exist or belongs to another company", async () => {
		const acmeJob = await createJob("open", "user_acme");
		const res = await upload("user_admin", acmeJob);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { code: "job_not_found", message: "That job doesn't exist or isn't yours" },
		});
		expect((await upload("user_admin", "no-such-job")).status).toBe(404);
		expect((await jobOf(acmeJob, "user_acme")).cvCount).toBe(0);
		expect(await keysUnder(`${acmeOrgId}/`)).toEqual([]);
	});

	it("409s when the job isn't open, so drafts and closed jobs can't take CVs", async () => {
		for (const status of ["draft", "closed"] as const) {
			const jobId = await createJob(status);
			const res = await upload("user_admin", jobId);
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: "job_not_open", message: "This job isn't open, so it can't take CVs. Open it first." },
			});
			expect((await jobOf(jobId)).cvCount).toBe(0);
		}
	});

	it("allows 10 CVs a job and answers the 11th with 403", async () => {
		const jobId = await createJob();
		for (let i = 0; i < 10; i += 1) await uploadOk("user_admin", jobId, { fileName: `cv-${i}.pdf` });

		const res = await upload("user_admin", jobId, { fileName: "cv-11.pdf" });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: { code: "cv_limit", message: "This job has used its 10 free CVs" } });
		expect((await jobOf(jobId)).cvCount).toBe(10);
		expect(creates).toHaveLength(10);
		expect(await keysUnder(`${orgId}/${jobId}/`)).toHaveLength(10);
	});

	it("lets exactly 10 of 11 simultaneous uploads through", async () => {
		const jobId = await createJob();
		const responses = await Promise.all(
			Array.from({ length: 11 }, (_, i) => upload("user_admin", jobId, { fileName: `cv-${i}.pdf` })),
		);

		expect(responses.map((res) => res.status).sort()).toEqual([201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 403]);
		const refused = responses.find((res) => res.status === 403);
		expect(await refused?.json()).toMatchObject({ error: { code: "cv_limit" } });
		expect((await jobOf(jobId)).cvCount).toBe(10);
		expect(creates).toHaveLength(10);
		expect(await keysUnder(`${orgId}/${jobId}/`)).toHaveLength(10);
	});

	it("gives the slot back and answers 502 when R2 fails", async () => {
		const jobId = await createJob();
		failPut = true;
		const res = await upload("user_admin", jobId);
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: { code: "upload_failed", message: "We couldn't store that file. Try again." },
		});

		expect((await jobOf(jobId)).cvCount).toBe(0);
		expect(await db.select().from(candidates).where(eq(candidates.jobId, jobId))).toEqual([]);
		expect(creates).toEqual([]);

		failPut = false;
		await uploadOk("user_admin", jobId);
		expect((await jobOf(jobId)).cvCount).toBe(1);
	});

	it("cleans up the file and the slot, through waitUntil, when the candidate row can't be saved", async () => {
		const jobId = await createJob();
		const otherJob = await createJob();
		// Make the new row collide with an existing id, so the insert fails after the file is in R2.
		const taken = await seed(otherJob);
		const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(taken as `${string}-${string}-${string}-${string}-${string}`);
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const res = await upload("user_admin", jobId);
			expect(res.status).toBe(500);
		} finally {
			uuid.mockRestore();
			quiet.mockRestore();
		}

		expect(await keysUnder(`${orgId}/${jobId}/`)).toEqual([]);
		expect((await jobOf(jobId)).cvCount).toBe(0);
		expect(creates).toEqual([]);
	});

	it("still answers 201 when the Workflow won't start, with the CV failed and retryable", async () => {
		const jobId = await createJob();
		failCreate = true;
		const candidate = await uploadOk("user_admin", jobId);
		expect(candidate).toMatchObject({
			status: "failed",
			error: "We couldn't start scoring this CV. Try again.",
			canRetry: true,
		});
		const [row] = await db.select().from(candidates).where(eq(candidates.id, candidate.id));
		expect(row).toMatchObject({ status: "failed", runs: 1 });
		expect(await bucket.head(row.fileKey)).not.toBeNull();
	});
});

describe("GET /jobs/:jobId/candidates", () => {
	it("404s for another company's job", async () => {
		const acmeJob = await createJob("open", "user_acme");
		const res = await send("user_admin", "GET", `/jobs/${acmeJob}/candidates`);
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "job_not_found" } });
	});

	it("lists scored CVs by score, then CVs being read, then failed ones, without caching", async () => {
		const jobId = await createJob();
		const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 10, minute));
		const scored = (score: number, scoredAt: Date) => ({ status: "scored" as const, score, scoredAt });
		const lower = await seed(jobId, scored(80, at(5)));
		const top = await seed(jobId, scored(90, at(9)));
		const earlier = await seed(jobId, scored(80, at(1)));
		const scoring = await seed(jobId, { status: "scoring", createdAt: at(20) });
		const queued = await seed(jobId, { status: "queued", createdAt: at(10) });
		const spent = await seed(jobId, { status: "failed", runs: 3, createdAt: at(30) });
		const retryable = await seed(jobId, { status: "failed", runs: 1, error: "Scoring failed.", createdAt: at(15) });
		await seed(await createJob("open", "user_acme"), scored(100, at(0)), acmeOrgId);

		const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as { candidates: CandidateJson[]; cvCount: number; cvLimit: number };

		expect(body.candidates.map((c) => c.id)).toEqual([top, earlier, lower, queued, scoring, retryable, spent]);
		expect(body.cvCount).toBe(0);
		expect(body.cvLimit).toBe(10);
		expect(body.candidates.find((c) => c.id === retryable)).toMatchObject({ canRetry: true, error: "Scoring failed." });
		expect(body.candidates.find((c) => c.id === spent)).toMatchObject({ canRetry: false });
		expect(body.candidates[0]).not.toHaveProperty("requirements");
		expect(body.candidates[0]).not.toHaveProperty("note");
	});

	it("breaks ties by score, then scored_at, then created_at, then id, and ranks only scored CVs", async () => {
		const jobId = await createJob();
		const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 10, minute));
		const scored = (score: number, scoredAt: Date, createdAt: Date) => ({ status: "scored" as const, score, scoredAt, createdAt });
		// Same score and scored_at: the earlier upload wins. Then the id decides between two identical rows.
		const laterUpload = await seed(jobId, { id: "z-later", ...scored(70, at(5), at(4)) });
		const earlierUpload = await seed(jobId, { id: "z-earlier", ...scored(70, at(5), at(2)) });
		const idTieB = await seed(jobId, { id: "tie-b", ...scored(70, at(5), at(4)) });
		const idTieA = await seed(jobId, { id: "tie-a", ...scored(70, at(5), at(4)) });
		const best = await seed(jobId, scored(71, at(30), at(30)));
		const reading = await seed(jobId, { status: "scoring", score: null });
		const failed = await seed(jobId, { status: "failed" });
		await seed(await createJob("open", "user_acme"), scored(100, at(0), at(0)), acmeOrgId);

		const { candidates: list } = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: CandidateJson[];
		};
		expect(list.map((c) => [c.id, c.rank])).toEqual([
			[best, 1],
			[earlierUpload, 2],
			[idTieA, 3],
			[idTieB, 4],
			[laterUpload, 5],
			[reading, null],
			[failed, null],
		]);

		// The candidate page says the same, out of the same five.
		for (const row of list.filter((c) => c.rank !== null)) {
			const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${row.id}`);
			const { candidate } = (await res.json()) as { candidate: CandidateJson };
			expect([candidate.rank, candidate.rankedCount]).toEqual([row.rank, 5]);
		}
		const unranked = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${failed}`);
		expect(((await unranked.json()) as { candidate: CandidateJson }).candidate).toMatchObject({ rank: null, rankedCount: 0 });
	});

	it("gives the list what it searches and shows: summary, email, every requirement and whether there is a note", async () => {
		const jobId = await createJob();
		const full = await seed(jobId, {
			status: "scored",
			score: 60,
			scoredAt: new Date(),
			summary: "Strong Swift.",
			note: "Call on Monday",
			profile: { email: "ada@example.com", phone: "+44 7946 095 800", links: [], skills: ["Swift"], experience: [], education: [], certifications: [] },
			requirements: [req("Swift", "must", true), req("Combine", "must", false), req("Figma", "nice", false)],
		});
		const bare = await seed(jobId, { status: "queued" });

		const { candidates: list } = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: (CandidateJson & { hasNote: boolean; profile: unknown; checks: unknown; summary: string | null })[];
		};
		expect(list.find((c) => c.id === full)).toMatchObject({
			summary: "Strong Swift.",
			hasNote: true,
			// Only the email: the phone and the rest of the profile are for the candidate page.
			profile: { email: "ada@example.com" },
			checks: [
				{ label: "Swift", met: true, importance: "must" },
				{ label: "Combine", met: false, importance: "must" },
				{ label: "Figma", met: false, importance: "nice" },
			],
		});
		expect(list.find((c) => c.id === full)).not.toHaveProperty("note");
		expect(list.find((c) => c.id === bare)).toMatchObject({ summary: null, hasNote: false, profile: null, checks: [] });

		// A note that was cleared is no note.
		await send("user_admin", "PATCH", `/jobs/${jobId}/candidates/${full}`, {
			headers: { "content-type": "application/json" },
			body: new TextEncoder().encode(JSON.stringify({ note: "" })),
		});
		const again = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: { id: string; hasNote: boolean }[];
		};
		expect(again.candidates.find((c) => c.id === full)?.hasNote).toBe(false);
	});

	it("shows met requirements as matches (must-haves first) and unmet must-haves as gaps, capped at 4 and 2", async () => {
		const jobId = await createJob();
		const many = await seed(jobId, {
			status: "scored",
			score: 50,
			scoredAt: new Date(),
			requirements: [
				req("Figma", "nice", true),
				req("Swift", "must", true),
				req("SwiftUI", "must", true),
				req("Combine", "must", false),
				req("5+ years iOS", "must", true),
				req("Jira", "nice", false),
				req("Testing", "must", true),
				req("CI/CD", "must", false),
				req("Kotlin", "must", false),
			],
		});
		const few = await seed(jobId, {
			status: "scored",
			score: 40,
			scoredAt: new Date(),
			requirements: [req("Figma", "nice", true), req("Swift", "must", true), req("Jira", "nice", false)],
		});

		const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates`);
		const { candidates: list } = (await res.json()) as { candidates: CandidateJson[] };
		expect(list.find((c) => c.id === many)).toMatchObject({
			matches: ["Swift", "SwiftUI", "5+ years iOS", "Testing"],
			gaps: ["Combine", "CI/CD"],
		});
		expect(list.find((c) => c.id === few)).toMatchObject({ matches: ["Swift", "Figma"], gaps: [] });
	});
});

describe("GET /jobs/:jobId/candidates/export.csv", () => {
	const exportCsv = (user: string | null, jobId: string, query = "") =>
		send(user, "GET", `/jobs/${jobId}/candidates/export.csv${query}`);
	// fetch's text() drops the BOM, so it is checked on the bytes.
	const lines = async (res: Response) => (await res.text()).replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);

	async function exportJob() {
		const jobId = await createJob();
		await db.update(jobs).set({ title: "Senior iOS Engineer" }).where(eq(jobs.id, jobId));
		const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 10, minute));
		const best = await seed(jobId, {
			status: "scored",
			score: 90,
			scoredAt: at(5),
			name: "Ada Lovelace",
			decision: "shortlisted",
			decidedAt: at(40),
			profile: { email: "ada@example.com", phone: "+44 7946 095 800", links: [], skills: [], experience: [], education: [], certifications: [] },
			requirements: [req("Swift", "must", true), req("Combine", "must", false)],
			summary: "Great, really.",
		});
		const next = await seed(jobId, { status: "scored", score: 60, scoredAt: at(6), name: "=Bob", note: "Maybe" });
		const rejected = await seed(jobId, { status: "scored", score: 30, scoredAt: at(7), name: "Cy", decision: "rejected" });
		const failed = await seed(jobId, { status: "failed", error: "Scoring failed." });
		const reading = await seed(jobId, { status: "scoring" });
		return { jobId, best, next, rejected, failed, reading };
	}

	it("sends every candidate, ranked, as a downloadable CSV that is not cached", async () => {
		const { jobId } = await exportJob();
		const res = await exportCsv("user_member", jobId);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe('attachment; filename="senior-ios-engineer-applicants.csv"');
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const rows = await lines(res);
		// Header, three scored by rank, then the CV being read and the failed one.
		expect(rows).toHaveLength(6);
		// The time it was applied depends on when the row was seeded, so it is checked apart.
		const [rank, name, email, phone, score, status, decision, note, decidedAt, , summary, matching, missing, reason] =
			rows[1].replace('"Great, really."', "Great; really.").split(",");
		expect([rank, name, email, phone, score, status, decision, note, decidedAt, summary, matching, missing, reason]).toEqual([
			"1",
			"Ada Lovelace",
			"ada@example.com",
			"'+44 7946 095 800",
			"90",
			"scored",
			"Shortlisted",
			"",
			"2026-10-22T10:40:00.000Z",
			"Great; really.",
			"Swift",
			"Combine",
			"",
		]);
		expect(rows[2]).toContain("2,'=Bob,,,60,scored,Undecided,Maybe,");
		expect(rows[3]).toContain("3,Cy,");
		expect(rows[4]).toMatch(/^,seed\.pdf,,,,scoring,/);
		expect(rows[5]).toMatch(/^,seed\.pdf,,,,failed,.*,Scoring failed\.$/);
	});

	it("filters by decision, keeps each CV's rank and names the file after the filter", async () => {
		const { jobId } = await exportJob();

		const rejected = await exportCsv("user_admin", jobId, "?decision=rejected");
		expect(rejected.headers.get("content-disposition")).toBe(
			'attachment; filename="senior-ios-engineer-rejected-applicants.csv"',
		);
		const rows = await lines(rejected);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatch(/^3,Cy,,,30,scored,Rejected,/);

		const undecided = await lines(await exportCsv("user_admin", jobId, "?decision=undecided"));
		expect(undecided).toHaveLength(4);
		expect(undecided[1]).toMatch(/^2,'=Bob,/);

		const shortlisted = await exportCsv("user_admin", jobId, "?decision=shortlisted");
		expect(shortlisted.headers.get("content-disposition")).toContain("-shortlisted-applicants.csv");
		expect(await lines(shortlisted)).toHaveLength(2);
		expect((await exportCsv("user_admin", jobId, "?decision=all")).headers.get("content-disposition")).toContain(
			'"senior-ios-engineer-applicants.csv"',
		);
	});

	it("numbers the CSV like the list and the candidate page", async () => {
		const { jobId, best, next } = await exportJob();
		const list = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates`)).json()) as {
			candidates: CandidateJson[];
		};
		const rows = await lines(await exportCsv("user_admin", jobId));
		const ranks = rows.slice(1).map((line) => line.split(",")[0]);
		expect(ranks).toEqual(list.candidates.map((c) => (c.rank === null ? "" : String(c.rank))));
		const page = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates/${next}`)).json()) as {
			candidate: CandidateJson;
		};
		expect(page.candidate.rank).toBe(2);
		expect(list.candidates[0].id).toBe(best);
	});

	it("refuses an unknown decision (400), a stranger's job (404) and a missing session (401)", async () => {
		const { jobId } = await exportJob();
		const bad = await exportCsv("user_admin", jobId, "?decision=maybe");
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_input");

		const acmeJob = await createJob("open", "user_acme");
		expect((await exportCsv("user_admin", acmeJob)).status).toBe(404);
		expect((await exportCsv("user_admin", "missing")).status).toBe(404);
		expect((await exportCsv(null, jobId)).status).toBe(401);
	});

	it("exports a job with no candidates as just the header", async () => {
		const jobId = await createJob();
		const rows = await lines(await exportCsv("user_admin", jobId));
		expect(rows).toHaveLength(1);
		expect(rows[0].startsWith("Rank,Name,Email")).toBe(true);
	});
});

describe("GET /jobs/:jobId/candidates/:id", () => {
	it("returns the full candidate, with its requirements and evidence", async () => {
		const jobId = await createJob();
		const requirements = [req("Swift", "must", true), req("Kotlin", "nice", false)];
		const id = await seed(jobId, {
			status: "scored",
			score: 67,
			scoredAt: new Date(),
			name: "Ada Lovelace",
			headline: "Senior iOS Engineer · London",
			summary: "Strong Swift background. No Kotlin.",
			requirements,
			fileSize: 2048,
			fileName: "ada.pdf",
		});

		const res = await send("user_member", "GET", `/jobs/${jobId}/candidates/${id}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toMatchObject({
			candidate: {
				id,
				name: "Ada Lovelace",
				headline: "Senior iOS Engineer · London",
				score: 67,
				summary: "Strong Swift background. No Kotlin.",
				requirements,
				fileSize: 2048,
				fileName: "ada.pdf",
				matches: ["Swift"],
				gaps: [],
			},
		});
	});

	it("404s for another company's candidate, a missing one, and the wrong job", async () => {
		const jobId = await createJob();
		const acmeJob = await createJob("open", "user_acme");
		const theirs = await seed(acmeJob, {}, acmeOrgId);
		const mine = await seed(jobId);
		const otherJob = await createJob();

		const paths = [
			`/jobs/${acmeJob}/candidates/${theirs}`,
			`/jobs/${jobId}/candidates/${theirs}`,
			`/jobs/${jobId}/candidates/nope`,
			`/jobs/${otherJob}/candidates/${mine}`,
		];
		for (const path of paths) {
			const res = await send("user_admin", "GET", path);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
			});
		}
	});
});

describe("PATCH /jobs/:jobId/candidates/:id", () => {
	type Decide = { decision?: string; note?: string | null };
	const decide = (user: string | null, jobId: string, id: string, body: unknown) =>
		send(user, "PATCH", `/jobs/${jobId}/candidates/${id}`, {
			headers: { "content-type": "application/json" },
			body: new TextEncoder().encode(JSON.stringify(body)),
		});
	const decideOk = async (user: string, jobId: string, id: string, body: Decide) => {
		const res = await decide(user, jobId, id, body);
		expect(res.status).toBe(200);
		return ((await res.json()) as { candidate: CandidateJson }).candidate;
	};
	const rowOf = async (id: string) => (await db.select().from(candidates).where(eq(candidates.id, id)))[0];
	const later = () => new Promise((resolve) => setTimeout(resolve, 5));

	it("starts undecided, and the list shows the decision while the note stays on the candidate", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "scored", score: 80, scoredAt: new Date() });

		const detail = (await (await send("user_admin", "GET", `/jobs/${jobId}/candidates/${id}`)).json()) as {
			candidate: CandidateJson;
		};
		expect(detail.candidate).toMatchObject({ decision: "undecided", note: null, decidedAt: null });

		await decideOk("user_admin", jobId, id, { decision: "shortlisted", note: "Call on Monday" });
		const list = await send("user_admin", "GET", `/jobs/${jobId}/candidates`);
		const { candidates: listed } = (await list.json()) as { candidates: CandidateJson[] };
		expect(listed[0]).toMatchObject({ id, decision: "shortlisted" });
		expect(listed[0]).not.toHaveProperty("note");
		expect(listed[0]).not.toHaveProperty("decidedAt");
	});

	it("sets decidedAt and decidedBy when the decision changes, and clears them on undecided", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "scored", score: 80, scoredAt: new Date() });

		const shortlisted = await decideOk("user_admin", jobId, id, { decision: "shortlisted" });
		expect(shortlisted).toMatchObject({ id, decision: "shortlisted", note: null });
		const first = Date.parse(shortlisted.decidedAt ?? "");
		expect(Date.now() - first).toBeLessThan(60_000);
		expect(await rowOf(id)).toMatchObject({
			decision: "shortlisted",
			decidedAt: new Date(first),
			decidedBy: "user_admin",
		});

		// Saying the same thing again, even as someone else, leaves who decided and when alone.
		await later();
		const same = await decideOk("user_member", jobId, id, { decision: "shortlisted" });
		expect(same.decidedAt).toBe(shortlisted.decidedAt);
		expect(await rowOf(id)).toMatchObject({ decidedAt: new Date(first), decidedBy: "user_admin" });

		// Changing it records the new person and time.
		const rejected = await decideOk("user_member", jobId, id, { decision: "rejected" });
		expect(rejected.decision).toBe("rejected");
		expect(Date.parse(rejected.decidedAt ?? "")).toBeGreaterThan(first);
		const second = Date.parse(rejected.decidedAt ?? "");
		expect(await rowOf(id)).toMatchObject({
			decision: "rejected",
			decidedAt: new Date(second),
			decidedBy: "user_member",
		});

		// A note alone isn't a decision.
		await later();
		const noted = await decideOk("user_admin", jobId, id, { note: "Not senior enough" });
		expect(noted).toMatchObject({ decision: "rejected", note: "Not senior enough" });
		expect(await rowOf(id)).toMatchObject({ decidedAt: new Date(second), decidedBy: "user_member" });

		// Back to undecided clears both, and the note stays.
		const undecided = await decideOk("user_admin", jobId, id, { decision: "undecided" });
		expect(undecided).toMatchObject({ decision: "undecided", decidedAt: null, note: "Not senior enough" });
		expect(await rowOf(id)).toMatchObject({ decision: "undecided", decidedAt: null, decidedBy: null });

		// Undecided to undecided stays clear.
		await decideOk("user_admin", jobId, id, { decision: "undecided" });
		expect(await rowOf(id)).toMatchObject({ decidedAt: null, decidedBy: null });

		// And shortlisted straight to rejected is a change, not a clear.
		await decideOk("user_admin", jobId, id, { decision: "shortlisted" });
		await decideOk("user_admin", jobId, id, { decision: "rejected" });
		expect(await rowOf(id)).toMatchObject({ decision: "rejected", decidedBy: "user_admin" });
		expect((await rowOf(id)).decidedAt).not.toBeNull();
	});

	it("takes a decision on a CV in any status, such as rejecting one that failed", async () => {
		const jobId = await createJob();
		for (const status of ["queued", "scoring", "scored", "failed"] as const) {
			const id = await seed(jobId, { status });
			expect(await decideOk("user_admin", jobId, id, { decision: "rejected" })).toMatchObject({
				status,
				decision: "rejected",
			});
		}
	});

	it("trims the note, stores an empty one as null, and keeps the decision when only the note changes", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "scored", score: 60, scoredAt: new Date() });
		await decideOk("user_admin", jobId, id, { decision: "shortlisted" });

		expect(await decideOk("user_member", jobId, id, { note: "  Strong on Swift.\n" })).toMatchObject({
			decision: "shortlisted",
			note: "Strong on Swift.",
		});
		expect((await rowOf(id)).note).toBe("Strong on Swift.");

		// A decision alone leaves the note.
		expect(await decideOk("user_member", jobId, id, { decision: "rejected" })).toMatchObject({
			note: "Strong on Swift.",
		});

		for (const empty of ["", "   \n\t ", null]) {
			await decideOk("user_admin", jobId, id, { note: "Something" });
			expect(await decideOk("user_admin", jobId, id, { note: empty })).toMatchObject({ note: null });
			expect((await rowOf(id)).note).toBeNull();
		}

		// Both at once.
		expect(await decideOk("user_admin", jobId, id, { decision: "shortlisted", note: " Call her " })).toMatchObject({
			decision: "shortlisted",
			note: "Call her",
		});
	});

	it("allows a note of 1000 characters after trimming, and refuses a longer one (400)", async () => {
		const jobId = await createJob();
		const id = await seed(jobId);

		const full = "n".repeat(NOTE_MAX);
		expect((await decideOk("user_admin", jobId, id, { note: `  ${full}  ` })).note).toBe(full);

		const res = await decide("user_admin", jobId, id, { note: "n".repeat(NOTE_MAX + 1) });
		expect(res.status).toBe(400);
		const message = "Keep the note to 1000 characters or fewer";
		expect(await res.json()).toEqual({ error: { code: "invalid_input", message, fields: { note: message } } });
		// Nothing was saved, not even the decision sent with it.
		const both = await decide("user_admin", jobId, id, { decision: "rejected", note: "n".repeat(NOTE_MAX + 1) });
		expect(both.status).toBe(400);
		expect(await rowOf(id)).toMatchObject({ note: full, decision: "undecided" });
	});

	it("refuses an empty body, an unknown decision and a note that isn't text (400 invalid_input)", async () => {
		const jobId = await createJob();
		const id = await seed(jobId);

		const bodies = [{}, { other: "field" }, { decision: "maybe" }, { decision: 1 }, { note: 5 }, { decision: null }];
		for (const body of bodies) {
			const res = await decide("user_admin", jobId, id, body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
		}
		expect((await decide("user_admin", jobId, id, {})).status).toBe(400);
		expect(await (await decide("user_admin", jobId, id, {})).json()).toMatchObject({
			error: { message: "Nothing to update" },
		});
		expect(await rowOf(id)).toMatchObject({ decision: "undecided", note: null, decidedAt: null });
	});

	it("leaves updated_at alone, so a stuck scoring run is still timed from its last real change", async () => {
		const jobId = await createJob();
		const updatedAt = new Date(Date.now() - STALE_SCORING_MS - 60_000);
		const stuck = await seed(jobId, { status: "scoring", updatedAt });
		const scored = await seed(jobId, { status: "scored", score: 50, scoredAt: new Date(), updatedAt });

		for (const id of [stuck, scored]) {
			await decideOk("user_admin", jobId, id, { decision: "shortlisted" });
			await decideOk("user_member", jobId, id, { note: "Look again" });
			await decideOk("user_member", jobId, id, { decision: "undecided", note: null });
			expect((await rowOf(id)).updatedAt).toEqual(updatedAt);
		}

		// So the stuck row still offers a retry, and the retry limit and clock are untouched.
		const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${stuck}`);
		const { candidate } = (await res.json()) as { candidate: CandidateJson };
		expect(candidate).toMatchObject({ status: "scoring", canRetry: true, updatedAt: updatedAt.toISOString() });
		expect((await rowOf(stuck)).runs).toBe(1);
	});

	it("is open to any member of the company, not only admins", async () => {
		const jobId = await createJob();
		const id = await seed(jobId);
		expect(await decideOk("user_member", jobId, id, { decision: "shortlisted", note: "Good" })).toMatchObject({
			decision: "shortlisted",
			note: "Good",
		});
		expect(await rowOf(id)).toMatchObject({ decidedBy: "user_member" });
	});

	it("needs a session and a company", async () => {
		const jobId = await createJob();
		const id = await seed(jobId);
		expect((await decide(null, jobId, id, { decision: "rejected" })).status).toBe(401);
		expect((await decide("user_new", jobId, id, { decision: "rejected" })).status).toBe(403);
		expect(await rowOf(id)).toMatchObject({ decision: "undecided" });
	});

	it("404s for another company's candidate, a missing one and the wrong job, and changes nothing", async () => {
		const jobId = await createJob();
		const acmeJob = await createJob("open", "user_acme");
		const theirs = await seed(acmeJob, {}, acmeOrgId);
		const mine = await seed(jobId);
		const otherJob = await createJob();

		const paths = [
			[acmeJob, theirs],
			[jobId, theirs],
			[jobId, "nope"],
			[otherJob, mine],
			["no-such-job", mine],
		];
		for (const [job, id] of paths) {
			const res = await decide("user_admin", job, id, { decision: "rejected", note: "No" });
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
			});
		}
		expect(await rowOf(theirs)).toMatchObject({ decision: "undecided", note: null });
		expect(await rowOf(mine)).toMatchObject({ decision: "undecided", note: null });
	});
});

describe("GET /jobs/:jobId/candidates/:id/cv", () => {
	// Every byte value, so a text round trip anywhere would show.
	const BYTES = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);

	it("streams the exact PDF bytes with the headers that show it in the browser", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_admin", jobId, { fileName: "ada.pdf", body: BYTES });

		const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-length")).toBe(String(BYTES.byteLength));
		expect(res.headers.get("content-disposition")).toBe(`inline; filename="ada.pdf"; filename*=UTF-8''ada.pdf`);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
	});

	it("hands R2's stream straight to the response without reading it", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_admin", jobId);
		const arrayBuffer = vi.fn();
		const text = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(PDF.slice(0, 10));
				controller.enqueue(PDF.slice(10));
				controller.close();
			},
		});
		const get = vi.spyOn(env.CVS, "get").mockResolvedValue({ body, size: PDF.byteLength, arrayBuffer, text } as never);
		try {
			const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`);
			expect(res.status).toBe(200);
			expect(get).toHaveBeenCalledWith(`${orgId}/${jobId}/${candidate.id}.pdf`);
			expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
		} finally {
			get.mockRestore();
		}
		expect(arrayBuffer).not.toHaveBeenCalled();
		expect(text).not.toHaveBeenCalled();
	});

	it("gives the file name in ASCII and, percent-encoded, in full", async () => {
		const jobId = await createJob();
		const fileName = 'résumé "final".pdf';
		const candidate = await uploadOk("user_member", jobId, { fileName });

		const res = await send("user_member", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-disposition")).toBe(
			`inline; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`,
		);

		// Quotes, backslashes, line breaks and emoji can't break out of the header either.
		const nasty = await uploadOk("user_member", jobId, { fileName: 'a";\\b\r\nX-Evil: 1 \u{1F600}.pdf' });
		const header = (await send("user_member", "GET", `/jobs/${jobId}/candidates/${nasty.id}/cv`)).headers.get(
			"content-disposition",
		);
		expect(header).toMatch(/^inline; filename="[A-Za-z0-9._ -]+"; filename\*=UTF-8''[A-Za-z0-9._~%!-]+$/);
		expect(header).toContain('filename="a___b__X-Evil_ 1 _.pdf"');

		// RFC 5987 doesn't allow ' ( ) * unencoded in filename*, though encodeURIComponent leaves them.
		const quoted = await uploadOk("user_member", jobId, { fileName: "Ada's CV (final)*.pdf" });
		expect(
			(await send("user_member", "GET", `/jobs/${jobId}/candidates/${quoted.id}/cv`)).headers.get("content-disposition"),
		).toBe(`inline; filename="Ada_s CV _final__.pdf"; filename*=UTF-8''Ada%27s%20CV%20%28final%29%2A.pdf`);
	});

	it("is open to any member of the company, not only admins", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_admin", jobId);
		const res = await send("user_member", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`);
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
	});

	it("404s with file_missing when the file is gone from R2", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_admin", jobId);
		await bucket.delete(`${orgId}/${jobId}/${candidate.id}.pdf`);

		const res = await send("user_admin", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: { code: "file_missing", message: "The CV file is missing" } });
	});

	it("404s for another company's candidate, a missing one and the wrong job, without touching R2", async () => {
		const jobId = await createJob();
		const acmeJob = await createJob("open", "user_acme");
		const theirs = await uploadOk("user_acme", acmeJob);
		const mine = await uploadOk("user_admin", jobId);
		const otherJob = await createJob();

		const get = vi.spyOn(env.CVS, "get");
		try {
			const paths = [
				`/jobs/${acmeJob}/candidates/${theirs.id}/cv`,
				`/jobs/${jobId}/candidates/${theirs.id}/cv`,
				`/jobs/${jobId}/candidates/nope/cv`,
				`/jobs/${otherJob}/candidates/${mine.id}/cv`,
			];
			for (const path of paths) {
				const res = await send("user_admin", "GET", path);
				expect(res.status).toBe(404);
				expect(await res.json()).toEqual({
					error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
				});
			}
			expect(get).not.toHaveBeenCalled();
		} finally {
			get.mockRestore();
		}
	});

	it("needs a session and a company", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_admin", jobId);
		expect((await send(null, "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`)).status).toBe(401);
		expect((await send("user_new", "GET", `/jobs/${jobId}/candidates/${candidate.id}/cv`)).status).toBe(403);
	});
});

describe("POST /jobs/:jobId/candidates/:id/retry", () => {
	it("won't retry a CV that is still being worked on, or one that scored (409 not_failed)", async () => {
		const jobId = await createJob();
		const recent = new Date(Date.now() - STALE_SCORING_MS + 60_000);
		const stale = new Date(Date.now() - STALE_SCORING_MS - 60_000);
		const rows = [
			{ status: "queued" as const, updatedAt: new Date() },
			{ status: "scoring" as const, updatedAt: new Date() },
			{ status: "queued" as const, updatedAt: recent },
			{ status: "scoring" as const, updatedAt: recent },
			// Scored is final, however old.
			{ status: "scored" as const, updatedAt: stale },
		];
		for (const row of rows) {
			const id = await seed(jobId, row);
			const res = await send("user_admin", "POST", `/jobs/${jobId}/candidates/${id}/retry`);
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: "not_failed", message: "Only a CV that failed or got stuck can be retried" },
			});
		}
		expect(creates).toEqual([]);
	});

	it("retries a CV stuck in queued or scoring for over 20 minutes, like a failed one", async () => {
		const jobId = await createJob();
		const updatedAt = new Date(Date.now() - STALE_SCORING_MS - 60_000);
		const stuckScoring = await seed(jobId, { status: "scoring", updatedAt });
		const stuckQueued = await seed(jobId, { status: "queued", updatedAt });

		const list = await send("user_admin", "GET", `/jobs/${jobId}/candidates`);
		const { candidates: listed } = (await list.json()) as { candidates: CandidateJson[] };
		expect(listed.find((c) => c.id === stuckScoring)).toMatchObject({ status: "scoring", canRetry: true });
		expect(listed.find((c) => c.id === stuckQueued)).toMatchObject({ status: "queued", canRetry: true });

		const res = await send("user_member", "POST", `/jobs/${jobId}/candidates/${stuckScoring}/retry`);
		expect(res.status).toBe(202);
		const { candidate } = (await res.json()) as { candidate: CandidateJson & { updatedAt: string } };
		expect(candidate).toMatchObject({ id: stuckScoring, status: "queued", error: null, canRetry: false });
		// The page times "taking longer than usual" from updatedAt, so a retry restarts that clock.
		expect(Date.now() - Date.parse(candidate.updatedAt)).toBeLessThan(60_000);
		expect(creates).toEqual([{ id: `${stuckScoring}-2`, params: { candidateId: stuckScoring } }]);

		// The retry made the row fresh again, so a second click does nothing.
		const again = await send("user_member", "POST", `/jobs/${jobId}/candidates/${stuckScoring}/retry`);
		expect(again.status).toBe(409);
		expect(creates).toHaveLength(1);
	});

	it("stops a stuck CV at the run limit too (409 retry_limit)", async () => {
		const jobId = await createJob();
		const updatedAt = new Date(Date.now() - STALE_SCORING_MS - 60_000);
		const id = await seed(jobId, { status: "scoring", runs: 3, updatedAt });

		const list = await send("user_admin", "GET", `/jobs/${jobId}/candidates`);
		const { candidates: listed } = (await list.json()) as { candidates: CandidateJson[] };
		expect(listed.find((c) => c.id === id)).toMatchObject({ canRetry: false });

		const res = await send("user_admin", "POST", `/jobs/${jobId}/candidates/${id}/retry`);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "retry_limit" } });
		expect(creates).toEqual([]);
	});

	it("stops after 3 runs (409 retry_limit)", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "failed", runs: 3, error: "Scoring failed. Try again." });
		const res = await send("user_admin", "POST", `/jobs/${jobId}/candidates/${id}/retry`);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: { code: "retry_limit", message: "We've tried this CV 3 times. It may not be a readable PDF." },
		});
		expect(creates).toEqual([]);
	});

	it("404s for another company's candidate", async () => {
		const acmeJob = await createJob("open", "user_acme");
		const theirs = await seed(acmeJob, { status: "failed" }, acmeOrgId);
		expect((await send("user_admin", "POST", `/jobs/${acmeJob}/candidates/${theirs}/retry`)).status).toBe(404);
		expect((await send("user_admin", "POST", `/jobs/${acmeJob}/candidates/nope/retry`)).status).toBe(404);
	});

	it("queues the CV again as a new Workflow instance named after the run, twice at most", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "failed", runs: 1, error: "Scoring failed. Try again." });
		const retry = () => send("user_member", "POST", `/jobs/${jobId}/candidates/${id}/retry`);

		const first = await retry();
		expect(first.status).toBe(202);
		expect(await first.json()).toMatchObject({ candidate: { id, status: "queued", error: null, canRetry: false } });
		expect(creates).toEqual([{ id: `${id}-2`, params: { candidateId: id } }]);

		// It fails again; the last retry is the third run.
		await db.update(candidates).set({ status: "failed" }).where(eq(candidates.id, id));
		expect((await retry()).status).toBe(202);
		expect(creates.at(-1)).toEqual({ id: `${id}-3`, params: { candidateId: id } });
		const [row] = await db.select().from(candidates).where(eq(candidates.id, id));
		expect(row.runs).toBe(3);

		await db.update(candidates).set({ status: "failed" }).where(eq(candidates.id, id));
		expect((await retry()).status).toBe(409);
		expect(creates).toHaveLength(2);
	});

	it("fails the CV again, still answering 202, when the Workflow won't start", async () => {
		const jobId = await createJob();
		const id = await seed(jobId, { status: "failed", runs: 1 });
		failCreate = true;
		const res = await send("user_admin", "POST", `/jobs/${jobId}/candidates/${id}/retry`);
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({
			candidate: { status: "failed", error: "We couldn't start scoring this CV. Try again.", canRetry: true },
		});
	});
});

describe("DELETE /jobs/:jobId/candidates/:id", () => {
	it("lets an admin delete the row and the R2 file, and the job keeps the slot", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_member", jobId);
		const key = `${orgId}/${jobId}/${candidate.id}.pdf`;
		expect(await bucket.head(key)).not.toBeNull();

		const res = await send("user_admin", "DELETE", `/jobs/${jobId}/candidates/${candidate.id}`);
		expect(res.status).toBe(204);
		expect((await send("user_admin", "GET", `/jobs/${jobId}/candidates/${candidate.id}`)).status).toBe(404);
		expect(await bucket.head(key)).toBeNull();
		expect((await jobOf(jobId)).cvCount).toBe(1);
	});

	it("is for admins only", async () => {
		const jobId = await createJob();
		const candidate = await uploadOk("user_member", jobId);
		const res = await send("user_member", "DELETE", `/jobs/${jobId}/candidates/${candidate.id}`);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: { code: "forbidden", message: "Only admins can delete candidates" } });
		expect((await send("user_admin", "GET", `/jobs/${jobId}/candidates/${candidate.id}`)).status).toBe(200);
		expect(await bucket.head(`${orgId}/${jobId}/${candidate.id}.pdf`)).not.toBeNull();
	});

	it("404s for another company's candidate and leaves its file alone", async () => {
		const acmeJob = await createJob("open", "user_acme");
		const theirs = await uploadOk("user_acme", acmeJob);
		const res = await send("user_admin", "DELETE", `/jobs/${acmeJob}/candidates/${theirs.id}`);
		expect(res.status).toBe(404);
		expect(await bucket.head(`${acmeOrgId}/${acmeJob}/${theirs.id}.pdf`)).not.toBeNull();
	});
});

describe("DELETE /jobs/:id", () => {
	it("also deletes the job's CV files, and only its own", async () => {
		const jobId = await createJob();
		const keepJob = await createJob();
		await uploadOk("user_admin", jobId, { fileName: "a.pdf" });
		await uploadOk("user_admin", jobId, { fileName: "b.pdf" });
		await uploadOk("user_admin", keepJob);
		expect(await keysUnder(`${orgId}/${jobId}/`)).toHaveLength(2);

		expect((await send("user_admin", "DELETE", `/jobs/${jobId}`)).status).toBe(204);
		expect(await keysUnder(`${orgId}/${jobId}/`)).toEqual([]);
		expect(await keysUnder(`${orgId}/${keepJob}/`)).toHaveLength(1);
		expect(await db.select().from(candidates).where(eq(candidates.jobId, jobId))).toEqual([]);
	});

	it("leaves another company's files alone when the delete is refused", async () => {
		const acmeJob = await createJob("open", "user_acme");
		await uploadOk("user_acme", acmeJob);
		expect((await send("user_admin", "DELETE", `/jobs/${acmeJob}`)).status).toBe(404);
		expect(await keysUnder(`${acmeOrgId}/${acmeJob}/`)).toHaveLength(1);
	});
});

describe("deleteCvFiles", () => {
	it("deletes in batches of at most 1000 keys, and never throws", async () => {
		const batches: string[][] = [];
		const fake = { delete: async (keys: string[]) => void batches.push(keys) } as unknown as R2Bucket;
		await deleteCvFiles(fake, Array.from({ length: 2500 }, (_, i) => `k${i}`));
		expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 500]);

		const broken = { delete: async () => Promise.reject(new Error("R2 is down")) } as unknown as R2Bucket;
		await expect(deleteCvFiles(broken, ["k"])).resolves.toBeUndefined();
	});
});

describe("computeScore", () => {
	it("counts must-haves double", () => {
		expect(computeScore([req("a", "must", true), req("b", "must", true), req("c", "nice", true)])).toBe(100);
		expect(computeScore([req("a", "must", false), req("b", "nice", false), req("c", "nice", false)])).toBe(0);
		// 2 of 3 must-haves and 1 of 2 nice-to-haves: (2*2 + 1) / (2*3 + 2) = 5/8 = 62.5, rounded up.
		expect(
			computeScore([
				req("a", "must", true),
				req("b", "must", true),
				req("c", "must", false),
				req("d", "nice", true),
				req("e", "nice", false),
			]),
		).toBe(63);
		// An unmet must-have costs the same as two unmet nice-to-haves: both come to 4/6.
		const unmetMust = [req("a", "must", false), req("b", "nice", true), req("c", "nice", true), req("d", "must", true)];
		const unmetNice = [req("a", "must", true), req("b", "must", true), req("c", "nice", false), req("d", "nice", false)];
		expect(computeScore(unmetMust)).toBe(67);
		expect(computeScore(unmetNice)).toBe(67);
	});

	it("is 0 with no requirements instead of dividing by zero", () => {
		expect(computeScore([])).toBe(0);
	});
});
