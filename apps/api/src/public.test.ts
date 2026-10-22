import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@lucid-hire/plans";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { CV_MAX_BYTES, takeSlot } from "./candidates.ts";
import { type Db, getDb } from "./db/client.ts";
import { candidates, jobs, usageCounters } from "./db/schema.ts";
import { newSlug, slugify } from "./jobs.ts";
import { createOrgForUser } from "./orgs.ts";
import { normalizeEmail, verifyTurnstile } from "./public.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let db: Db;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let orgId: string;
let captchaOk: boolean;
let captchaCalls: { token: string; ip: string | undefined }[];
let rateLimitOk: boolean;
let rateKeys: string[];
let failPut: boolean;
let failCreate: boolean;
let creates: { id: string; params: unknown }[];

const verify: SessionVerifier = async (token) => {
	if (!token.startsWith("t:")) throw new Error("invalid token");
	return { userId: token.slice(2) };
};

const app = createApp({
	verifySession: verify,
	verifyCaptcha: async (_env, token, ip) => {
		captchaCalls.push({ token, ip });
		return captchaOk;
	},
});

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(body)) });

beforeAll(async () => {
	const testD1 = await createTestD1();
	dispose = testD1.dispose;
	bucket = testD1.cvs;
	env = {
		CLERK_SECRET_KEY: "sk_test_unit",
		GOOGLE_GENERATIVE_AI_API_KEY: "unit",
		TURNSTILE_SECRET_KEY: "turnstile-secret",
		DB: testD1.d1,
		APPLY_RATE_LIMIT: {
			limit: async ({ key }: { key: string }) => {
				rateKeys.push(key);
				return { success: rateLimitOk };
			},
		},
		CVS: {
			put: async (key: string, value: unknown, options: R2PutOptions) => {
				if (failPut) throw new Error("R2 is down");
				const body = value instanceof ReadableStream ? await new Response(value).arrayBuffer() : (value as ArrayBuffer);
				return bucket.put(key, body, options);
			},
			get: (key: string) => bucket.get(key),
			delete: (keys: string | string[]) => bucket.delete(keys),
		},
		SCORE_CV: {
			create: async (options: { id: string; params: unknown }) => {
				if (failCreate) throw new Error("Workflows is down");
				creates.push(options);
				return { id: options.id };
			},
		},
	} as unknown as Env;
	db = getDb(testD1.d1);
	orgId = (await createOrgForUser(db, "user_admin", "Sprite Labs")).org.id;
});

afterAll(() => dispose());

beforeEach(async () => {
	// Every test starts with a fresh monthly job allowance.
	await db.delete(usageCounters);
	captchaOk = true;
	captchaCalls = [];
	rateLimitOk = true;
	rateKeys = [];
	failPut = false;
	failCreate = false;
	creates = [];
});

async function send(method: string, path: string, init: { headers?: Record<string, string>; body?: Uint8Array } = {}) {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
	const res = await app.request(path, { method, headers: init.headers, body: init.body }, env, ctx as unknown as ExecutionContext);
	await Promise.all(pending);
	return res;
}

async function makeJob(status: "draft" | "open" | "closed" = "open", title = "Platform Engineer") {
	const created = await send("POST", "/jobs", {
		...json({ title, description: "## Role\nBuild **things**", status: status === "closed" ? "open" : status }),
		headers: { "content-type": "application/json", authorization: "Bearer t:user_admin" },
	});
	const { job } = (await created.json()) as { job: { id: string; slug: string } };
	if (status === "closed") await db.update(jobs).set({ status: "closed" }).where(eq(jobs.id, job.id));
	return job;
}

type ApplyOptions = { email?: string | null; token?: string | null; body?: Uint8Array; length?: string | null; fileName?: string };

function apply(slug: string, { email = "ada@example.com", token = "token-1", body = PDF, length, fileName = "Ada CV.pdf" }: ApplyOptions = {}) {
	const headers: Record<string, string> = { "x-file-name": encodeURIComponent(fileName), "cf-connecting-ip": "203.0.113.7" };
	if (email !== null) headers["x-applicant-email"] = email;
	if (token !== null) headers["x-turnstile-token"] = token;
	const size = length === undefined ? String(body.byteLength) : length;
	if (size !== null) headers["content-length"] = size;
	return send("POST", `/public/jobs/${slug}/apply`, { headers, body });
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe("slugs", () => {
	it("makes lower-case ASCII words joined by hyphens", () => {
		expect(slugify("Senior iOS Engineer")).toBe("senior-ios-engineer");
		expect(slugify("  Café -- Manager (Remote)!  ")).toBe("cafe-manager-remote");
	});

	it("falls back to 'job' when the title has no letters or digits", () => {
		expect(slugify("★★★")).toBe("job");
	});

	it("cuts a long title at a hyphen, within 60 characters", () => {
		const slug = slugify("Senior Principal Staff Distributed Systems Reliability Engineer for the Payments Platform");
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug).toBe("senior-principal-staff-distributed-systems-reliability");
		expect(slugify("a".repeat(200))).toHaveLength(60);
	});

	it("adds 8 random characters, so equal titles get different slugs", () => {
		const [a, b] = [newSlug("Designer"), newSlug("Designer")];
		expect(a).toMatch(/^designer-[a-z0-9]{8}$/);
		expect(a).not.toBe(b);
	});

	it("is set when a job is created, shown to the recruiter, and unchanged by edits", async () => {
		const job = await makeJob("draft", "Data Analyst");
		expect(job.slug).toMatch(/^data-analyst-[a-z0-9]{8}$/);
		const edited = await send("PATCH", `/jobs/${job.id}`, {
			...json({ title: "Completely Different" }),
			headers: { "content-type": "application/json", authorization: "Bearer t:user_admin" },
		});
		expect(((await edited.json()) as { job: { slug: string } }).job.slug).toBe(job.slug);
	});
});

describe("normalizeEmail", () => {
	it("tidies a good address and rejects the rest", () => {
		expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
		for (const bad of [undefined, "", "ada", "ada@", "@example.com", "ada@example", "a b@example.com", "a@@example.com", `${"a".repeat(250)}@example.com`]) {
			expect(normalizeEmail(bad)).toBeNull();
		}
	});
});

describe("GET /public/jobs/:slug", () => {
	it("shows an open job to anyone, with the company name and nothing internal", async () => {
		const job = await makeJob("open");
		const res = await send("GET", `/public/jobs/${job.slug}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=60");
		const body = (await res.json()) as { job: Record<string, unknown> };
		expect(Object.keys(body.job).sort()).toEqual(["company", "createdAt", "description", "hasCover", "slug", "status", "title"]);
		expect(body.job).toMatchObject({ slug: job.slug, title: "Platform Engineer", status: "open", company: "Sprite Labs", hasCover: false });
		expect(JSON.stringify(body)).not.toContain(orgId);
		expect(JSON.stringify(body)).not.toContain(job.id);
	});

	it("shows a closed job as closed", async () => {
		const job = await makeJob("closed");
		const res = await send("GET", `/public/jobs/${job.slug}`);
		expect(((await res.json()) as { job: { status: string } }).job.status).toBe("closed");
	});

	it("hides drafts and unknown slugs the same way", async () => {
		const draft = await makeJob("draft");
		for (const slug of [draft.slug, "no-such-job-12345678"]) {
			const res = await send("GET", `/public/jobs/${slug}`);
			expect(res.status).toBe(404);
			expect((await errorOf(res)).code).toBe("not_found");
		}
	});
});

describe("GET /public/sitemap", () => {
	it("lists open jobs only", async () => {
		const open = await makeJob("open", "Sitemap Open");
		const draft = await makeJob("draft", "Sitemap Draft");
		const closed = await makeJob("closed", "Sitemap Closed");
		const res = await send("GET", "/public/sitemap");
		expect(res.headers.get("cache-control")).toBe("public, max-age=60");
		const slugs = ((await res.json()) as { jobs: { slug: string; updatedAt: string }[] }).jobs.map((j) => j.slug);
		expect(slugs).toContain(open.slug);
		expect(slugs).not.toContain(draft.slug);
		expect(slugs).not.toContain(closed.slug);
	});
});

describe("POST /public/jobs/:slug/apply", () => {
	it("stores the CV, adds the candidate and starts scoring", async () => {
		const job = await makeJob();
		const res = await apply(job.slug);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ ok: true });

		const [row] = await db.select().from(candidates).where(eq(candidates.jobId, job.id));
		expect(row).toMatchObject({ source: "apply", email: "ada@example.com", createdBy: "applicant", status: "queued", fileName: "Ada CV.pdf", fileSize: PDF.byteLength, orgId });
		expect(row.fileKey).toBe(`${orgId}/${job.id}/${row.id}.pdf`);
		const stored = await bucket.get(row.fileKey);
		expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(PDF);
		expect(creates).toEqual([{ id: row.id, params: { candidateId: row.id } }]);
		expect(captchaCalls).toEqual([{ token: "token-1", ip: "203.0.113.7" }]);
		expect(rateKeys).toEqual([`203.0.113.7:${job.slug}`]);
		const [counted] = await db.select({ cvCount: jobs.cvCount }).from(jobs).where(eq(jobs.id, job.id));
		expect(counted.cvCount).toBe(1);
	});

	it("answers 404 for an unknown or draft job and 410 for a closed one", async () => {
		const draft = await makeJob("draft");
		expect((await apply(draft.slug)).status).toBe(404);
		expect((await apply("nope-00000000")).status).toBe(404);
		const closed = await makeJob("closed");
		const res = await apply(closed.slug);
		expect(res.status).toBe(410);
		expect(await errorOf(res)).toEqual({ code: "closed", message: "Applications for this job are closed." });
		expect(captchaCalls).toEqual([]);
	});

	it("checks the size before anything else", async () => {
		const job = await makeJob();
		expect((await apply(job.slug, { length: null })).status).toBe(411);
		expect((await apply(job.slug, { length: String(CV_MAX_BYTES + 1) })).status).toBe(413);
		const empty = await apply(job.slug, { body: new Uint8Array(0) });
		expect(empty.status).toBe(400);
		expect((await errorOf(empty)).code).toBe("empty_file");
		expect(captchaCalls).toEqual([]);
	});

	it("rejects a bad email and a non-PDF before spending the CAPTCHA token", async () => {
		const job = await makeJob();
		for (const email of [null, "", "not-an-email", "a@b"]) {
			const res = await apply(job.slug, { email });
			expect(res.status).toBe(400);
			expect(await errorOf(res)).toEqual({ code: "invalid_email", message: "Enter a valid email address" });
		}
		const notPdf = await apply(job.slug, { body: new TextEncoder().encode("PK\u0003\u0004 a zip file, not a CV") });
		expect(notPdf.status).toBe(400);
		expect(await errorOf(notPdf)).toEqual({ code: "not_pdf", message: "Upload your CV as a PDF file" });
		const tiny = await apply(job.slug, { body: new TextEncoder().encode("%PD") });
		expect(tiny.status).toBe(400);
		expect(captchaCalls).toEqual([]);
		expect(rateKeys).toEqual([]);
	});

	it("refuses a missing or failed CAPTCHA with 403", async () => {
		const job = await makeJob();
		const missing = await apply(job.slug, { token: null });
		expect(missing.status).toBe(403);
		captchaOk = false;
		const failed = await apply(job.slug);
		expect(failed.status).toBe(403);
		expect(await errorOf(failed)).toEqual({ code: "captcha_failed", message: "The security check didn't pass. Try again." });
		expect(rateKeys).toEqual([]);
		expect(await db.select().from(candidates).where(eq(candidates.jobId, job.id))).toHaveLength(0);
	});

	it("answers 429 when the rate limit is hit", async () => {
		const job = await makeJob();
		rateLimitOk = false;
		const res = await apply(job.slug);
		expect(res.status).toBe(429);
		expect((await errorOf(res)).code).toBe("rate_limited");
		expect(await db.select().from(candidates).where(eq(candidates.jobId, job.id))).toHaveLength(0);
	});

	it("answers 409 for the same email twice, whatever its case, and keeps one slot", async () => {
		const job = await makeJob();
		expect((await apply(job.slug)).status).toBe(201);
		const again = await apply(job.slug, { email: "ADA@example.com" });
		expect(again.status).toBe(409);
		expect(await errorOf(again)).toEqual({
			code: "already_applied",
			message: "You have already applied to this job using this email address.",
		});
		expect((await apply(job.slug, { email: "grace@example.com" })).status).toBe(201);
		const [counted] = await db.select({ cvCount: jobs.cvCount }).from(jobs).where(eq(jobs.id, job.id));
		expect(counted.cvCount).toBe(2);
	});

	it("lets the same person apply to a different job", async () => {
		const [a, b] = [await makeJob(), await makeJob()];
		expect((await apply(a.slug)).status).toBe(201);
		expect((await apply(b.slug)).status).toBe(201);
	});

	it("never reveals plan usage when the job is full", async () => {
		const job = await makeJob();
		for (let i = 0; i < PLANS.free.cvsPerJob; i++) expect((await takeSlot(db, orgId, job.id)).ok).toBe(true);
		const res = await apply(job.slug);
		expect(res.status).toBe(409);
		const error = await errorOf(res);
		expect(error).toEqual({ code: "not_accepting", message: "This job isn't taking more applications right now." });
		expect(JSON.stringify(error)).not.toMatch(/free|10|plan|upgrade|billing/i);
		expect(await db.select().from(candidates).where(eq(candidates.jobId, job.id))).toHaveLength(0);
	});

	it("releases the slot when R2 fails", async () => {
		const job = await makeJob();
		failPut = true;
		const res = await apply(job.slug);
		expect(res.status).toBe(502);
		const [counted] = await db.select({ cvCount: jobs.cvCount }).from(jobs).where(eq(jobs.id, job.id));
		expect(counted.cvCount).toBe(0);
		failPut = false;
		expect((await apply(job.slug)).status).toBe(201);
	});

	it("still answers 201 when the Workflow won't start, leaving a retryable failed CV", async () => {
		const job = await makeJob();
		failCreate = true;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await apply(job.slug);
		logged.mockRestore();
		expect(res.status).toBe(201);
		const [row] = await db.select().from(candidates).where(eq(candidates.jobId, job.id));
		expect(row.status).toBe("failed");
		expect(row.error).toBe("We couldn't start scoring this CV. Try again.");
	});

	it("keeps recruiter uploads without an email from colliding", async () => {
		const job = await makeJob();
		for (const id of ["u1", "u2"]) {
			await db.insert(candidates).values({ id, orgId, jobId: job.id, fileKey: id, fileName: "a.pdf", fileSize: 1, createdBy: "user_admin" });
		}
		expect(await db.select().from(candidates).where(eq(candidates.jobId, job.id))).toHaveLength(2);
	});

	it("falls back to a plain file name when the header is missing or not a PDF name", async () => {
		const job = await makeJob();
		expect((await apply(job.slug, { fileName: "résumé.docx" })).status).toBe(201);
		const [row] = await db.select().from(candidates).where(eq(candidates.jobId, job.id));
		expect(row.fileName).toBe("cv.pdf");
	});
});

describe("verifyTurnstile", () => {
	const call = (token = "t") => verifyTurnstile({ TURNSTILE_SECRET_KEY: "s3cret" } as Env, token, "198.51.100.1");
	const answer = (body: unknown, status = 200) => vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));

	it("posts the secret, token and visitor address to Siteverify and accepts our hostname", async () => {
		const fetchMock = answer({ success: true, hostname: "lucidhire.io" });
		expect(await call("tok")).toBe(true);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
		expect(String(init?.body)).toBe("secret=s3cret&response=tok&remoteip=198.51.100.1");
		fetchMock.mockRestore();
	});

	it("accepts the test host example.com only with Cloudflare's always-pass test secret", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Response.json({ success: true, hostname: "example.com" }));
		expect(await call()).toBe(false);
		const testSecret = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" } as Env;
		expect(await verifyTurnstile(testSecret, "t", undefined)).toBe(true);
		fetchMock.mockRestore();
	});

	it("accepts localhost, and refuses other hostnames, failures and outages", async () => {
		let fetchMock = answer({ success: true, hostname: "localhost" });
		expect(await call()).toBe(true);
		fetchMock.mockRestore();
		fetchMock = answer({ success: true, hostname: "evil.example" });
		expect(await call()).toBe(false);
		fetchMock.mockRestore();
		fetchMock = answer({ success: false, hostname: "lucidhire.io" });
		expect(await call()).toBe(false);
		fetchMock.mockRestore();
		fetchMock = answer({}, 500);
		expect(await call()).toBe(false);
		fetchMock.mockRestore();
		fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		expect(await call()).toBe(false);
		fetchMock.mockRestore();
	});
});

describe("cover image", () => {
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
	const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
	const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
	const as = (user: string | null, method: string, path: string, init: { type?: string; body?: Uint8Array; length?: string } = {}) => {
		const headers: Record<string, string> = {};
		if (user) headers.authorization = `Bearer t:${user}`;
		if (init.type) headers["content-type"] = init.type;
		if (init.body) headers["content-length"] = init.length ?? String(init.body.byteLength);
		return send(method, path, { headers, body: init.body });
	};

	it("stores a cover under covers/<org>/<job>, marks the job and serves it publicly", async () => {
		const job = await makeJob();
		const put = await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG });
		expect(put.status).toBe(200);
		expect(((await put.json()) as { job: { hasCover: boolean } }).job.hasCover).toBe(true);
		expect(new Uint8Array(await (await bucket.get(`covers/${orgId}/${job.id}`))!.arrayBuffer())).toEqual(PNG);

		const page = await send("GET", `/public/jobs/${job.slug}`);
		expect(((await page.json()) as { job: { hasCover: boolean } }).job.hasCover).toBe(true);
		const image = await send("GET", `/public/jobs/${job.slug}/cover`);
		expect(image.status).toBe(200);
		expect(image.headers.get("content-type")).toBe("image/png");
		expect(image.headers.get("cache-control")).toBe("public, max-age=300");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
	});

	it("replaces the old cover and takes the type from the bytes", async () => {
		const job = await makeJob();
		await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG });
		await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/jpeg", body: WEBP });
		const image = await send("GET", `/public/jobs/${job.slug}/cover`);
		expect(image.headers.get("content-type")).toBe("image/webp");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(WEBP);
		const jpeg = await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/jpeg", body: JPEG });
		expect(jpeg.status).toBe(200);
	});

	it("refuses other types, fake images, empty and big files", async () => {
		const job = await makeJob();
		const put = (init: Parameters<typeof as>[3]) => as("user_admin", "PUT", `/jobs/${job.id}/cover`, init);
		expect((await put({ type: "image/gif", body: PNG })).status).toBe(415);
		expect((await put({ body: PNG })).status).toBe(415);
		expect((await put({ type: "image/png", body: new TextEncoder().encode("<svg onload=alert(1)>") })).status).toBe(415);
		expect((await put({ type: "image/png", body: PNG, length: String(2 * 1024 * 1024 + 1) })).status).toBe(413);
		expect((await put({ type: "image/png", body: new Uint8Array(0) })).status).toBe(400);
		const missingLength = await send("PUT", `/jobs/${job.id}/cover`, {
			headers: { authorization: "Bearer t:user_admin", "content-type": "image/png" },
		});
		expect(missingLength.status).toBe(411);
		expect(await bucket.get(`covers/${orgId}/${job.id}`)).toBeNull();
	});

	it("shows the recruiter their own cover, even on a draft", async () => {
		const job = await makeJob("draft");
		expect((await as("user_admin", "GET", `/jobs/${job.id}/cover`)).status).toBe(404);
		await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG });
		const res = await as("user_admin", "GET", `/jobs/${job.id}/cover`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
		expect((await as("user_acme_none", "GET", `/jobs/${job.id}/cover`)).status).toBe(403);
	});

	it("removes the cover", async () => {
		const job = await makeJob();
		await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG });
		const del = await as("user_admin", "DELETE", `/jobs/${job.id}/cover`);
		expect(((await del.json()) as { job: { hasCover: boolean } }).job.hasCover).toBe(false);
		expect(await bucket.get(`covers/${orgId}/${job.id}`)).toBeNull();
		expect((await send("GET", `/public/jobs/${job.slug}/cover`)).status).toBe(404);
	});

	it("needs a session and the company's own job", async () => {
		const job = await makeJob();
		expect((await as(null, "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG })).status).toBe(401);
		const other = await createOrgForUser(db, "user_other", "Other Co");
		expect(other.created).toBe(true);
		expect((await as("user_other", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG })).status).toBe(404);
		expect((await as("user_other", "DELETE", `/jobs/${job.id}/cover`)).status).toBe(404);
	});

	it("is removed with the job, and a draft's cover is never public", async () => {
		const job = await makeJob("draft");
		await as("user_admin", "PUT", `/jobs/${job.id}/cover`, { type: "image/png", body: PNG });
		expect((await send("GET", `/public/jobs/${job.slug}/cover`)).status).toBe(404);
		await as("user_admin", "DELETE", `/jobs/${job.id}`);
		expect(await bucket.get(`covers/${orgId}/${job.id}`)).toBeNull();
	});
});
