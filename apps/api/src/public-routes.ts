import { Hono } from "hono";
import {
	CV_MAX_BYTES,
	type Candidate,
	createCandidate,
	deleteCvFiles,
	markStartFailed,
	releaseSlot,
	takeSlot,
} from "./candidates.ts";
import { getDb } from "./db/client.ts";
import {
	type CaptchaVerifier,
	checkPdfBody,
	getApplyTarget,
	getCoverKey,
	getPublicJob,
	hasApplied,
	listOpenJobSlugs,
	normalizeEmail,
} from "./public.ts";
import type { AppEnv } from "./types.ts";

const PUBLIC_JOB_CACHE = "public, max-age=60";
const COVER_CACHE = "public, max-age=300";
const MAX_MB = CV_MAX_BYTES / (1024 * 1024);
const FILE_NAME_MAX = 200;

const err = (code: string, message: string) => ({ error: { code, message } });
const notFound = err("not_found", "This job isn't available");

// The name the applicant's browser gave the file, tidied; a fixed one when it is missing or odd. Only shown to the
// recruiter, so a bad name never blocks an application.
function applicantFileName(raw: string | undefined): string {
	let name = raw?.trim() ?? "";
	try {
		name = decodeURIComponent(name);
	} catch {
		// Keep it as sent.
	}
	name = name.replace(/\p{Cc}/gu, "");
	if (!/\.pdf$/i.test(name)) return "cv.pdf";
	return name.length > FILE_NAME_MAX ? name.slice(0, FILE_NAME_MAX - 4) + name.slice(-4) : name;
}

// Starts a scoring run. If the Workflow won't start, the CV is failed with a retryable message instead of
// sitting queued forever, and the applicant still hears that their CV arrived.
async function startScoring(env: Env, db: ReturnType<typeof getDb>, requestId: string, candidate: Candidate) {
	try {
		await env.SCORE_CV.create({ id: candidate.id, params: { candidateId: candidate.id } });
	} catch (error) {
		console.error(`[${requestId}] scoring did not start for applicant ${candidate.id}`, error);
		await markStartFailed(db, candidate.id).catch(() => null);
	}
}

type PublicRouteOptions = { verifyCaptcha: CaptchaVerifier };

// What applicants and search engines see. No session, and nothing here reveals a company's id, its plan usage or
// anything about its recruiters or other candidates.
export function publicRoutes({ verifyCaptcha }: PublicRouteOptions) {
	const routes = new Hono<AppEnv>();

	routes.get("/sitemap", async (c) => {
		const jobs = await listOpenJobSlugs(getDb(c.env.DB));
		return c.json({ jobs }, 200, { "Cache-Control": PUBLIC_JOB_CACHE });
	});

	routes.get("/jobs/:slug", async (c) => {
		const job = await getPublicJob(getDb(c.env.DB), c.req.param("slug"));
		return job ? c.json({ job }, 200, { "Cache-Control": PUBLIC_JOB_CACHE }) : c.json(notFound, 404);
	});

	routes.get("/jobs/:slug/cover", async (c) => {
		const key = await getCoverKey(getDb(c.env.DB), c.req.param("slug"));
		const object = key ? await c.env.CVS.get(key) : null;
		if (!object) return c.json(notFound, 404);
		return c.body(object.body, 200, {
			"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
			"Content-Length": String(object.size),
			"Cache-Control": COVER_CACHE,
			"X-Content-Type-Options": "nosniff",
		});
	});

	// The body is the raw PDF, like a recruiter's upload; the email, the Turnstile token and the file name travel in
	// headers. Checked cheapest first, and everything the applicant can get wrong before the CAPTCHA, so a typo
	// doesn't spend their token.
	routes.post("/jobs/:slug/apply", async (c) => {
		const db = getDb(c.env.DB);
		const slug = c.req.param("slug");

		const job = await getApplyTarget(db, slug);
		if (!job) return c.json(notFound, 404);
		if (job.status !== "open") return c.json(err("closed", "Applications for this job are closed."), 410);

		const contentLength = c.req.header("content-length");
		if (!contentLength || !/^\d+$/.test(contentLength)) {
			return c.json(err("length_required", "Choose your CV again"), 411);
		}
		const fileSize = Number(contentLength);
		if (fileSize > CV_MAX_BYTES) return c.json(err("too_large", `Your CV must be ${MAX_MB} MB or smaller`), 413);
		if (fileSize === 0) return c.json(err("empty_file", "That file is empty"), 400);

		const email = normalizeEmail(c.req.header("x-applicant-email"));
		if (!email) return c.json(err("invalid_email", "Enter a valid email address"), 400);
		const body = c.req.raw.body;
		const pdf = body ? await checkPdfBody(body, fileSize) : null;
		if (!pdf) return c.json(err("not_pdf", "Upload your CV as a PDF file"), 400);

		const ip = c.req.header("cf-connecting-ip");
		const token = c.req.header("x-turnstile-token");
		if (!token || !(await verifyCaptcha(c.env, token, ip))) {
			return c.json(err("captcha_failed", "The security check didn't pass. Try again."), 403);
		}

		const { success } = await c.env.APPLY_RATE_LIMIT.limit({ key: `${ip ?? "unknown"}:${slug}` });
		if (!success) {
			return c.json(err("rate_limited", "Too many applications from your connection. Try again in a minute."), 429);
		}

		if (await hasApplied(db, job.id, email)) {
			return c.json(err("already_applied", "You have already applied to this job using this email address."), 409);
		}

		// Never says why: the employer's plan usage is theirs alone.
		const slot = await takeSlot(db, job.orgId, job.id);
		if (!slot.ok) {
			const message = "This job isn't taking more applications right now.";
			return c.json(err("not_accepting", message), 409);
		}

		const id = crypto.randomUUID();
		const fileKey = `${job.orgId}/${job.id}/${id}.pdf`;
		try {
			await c.env.CVS.put(fileKey, pdf, { httpMetadata: { contentType: "application/pdf" } });
		} catch (error) {
			console.error(`[${c.get("requestId")}] applicant cv upload to R2 failed`, error);
			c.executionCtx.waitUntil(releaseSlot(db, job.orgId, job.id));
			return c.json(err("upload_failed", "We couldn't store your CV. Try again."), 502);
		}

		let candidate: Candidate;
		try {
			candidate = await createCandidate(db, {
				id,
				orgId: job.orgId,
				jobId: job.id,
				fileKey,
				fileName: applicantFileName(c.req.header("x-file-name")),
				fileSize,
				createdBy: "applicant",
				source: "apply",
				email,
			});
		} catch (error) {
			// Don't leave a file nobody can see, or a slot nobody used.
			c.executionCtx.waitUntil(Promise.all([deleteCvFiles(c.env.CVS, [fileKey]), releaseSlot(db, job.orgId, job.id)]));
			// Two applications with one email racing each other: the unique index let only the first through.
			if (error instanceof Error && /UNIQUE/i.test(`${error.message} ${error.cause}`)) {
				return c.json(err("already_applied", "You have already applied to this job using this email address."), 409);
			}
			throw error;
		}

		await startScoring(c.env, db, c.get("requestId"), candidate);
		return c.json({ ok: true }, 201);
	});

	return routes;
}
