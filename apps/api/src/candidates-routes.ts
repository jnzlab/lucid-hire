import { Hono } from "hono";
import {
	CV_FILE_NAME_MAX,
	CV_LIMIT_PER_JOB,
	CV_MAX_BYTES,
	type Candidate,
	DEFAULT_CV_FILE_NAME,
	MAX_SCORING_RUNS,
	createCandidate,
	decideCandidate,
	decideInput,
	deleteCandidate,
	deleteCvFiles,
	getCandidate,
	getCvCount,
	getCvFile,
	listCandidates,
	listForExport,
	markStartFailed,
	releaseSlot,
	startRetry,
	takeSlot,
} from "./candidates.ts";
import { buildCsv, exportFileName, exportQuery } from "./candidates-export.ts";
import { type Db, getDb } from "./db/client.ts";
import { getJob } from "./jobs.ts";
import type { AppEnv } from "./types.ts";
import { validJson, validQuery } from "./validation.ts";

const jobNotFound = { error: { code: "job_not_found", message: "That job doesn't exist or isn't yours" } };
const candidateNotFound = {
	error: { code: "candidate_not_found", message: "That candidate doesn't exist or isn't yours" },
};
const fileMissing = { error: { code: "file_missing", message: "The CV file is missing" } };

// The file name from the query, tidied; null unless it is a .pdf.
function cleanFileName(raw: string | undefined): string | null {
	const name = raw?.trim() || DEFAULT_CV_FILE_NAME;
	if (!/\.pdf$/i.test(name)) return null;
	// Cut the middle, so the name still ends in .pdf.
	return name.length > CV_FILE_NAME_MAX ? name.slice(0, CV_FILE_NAME_MAX - 4) + name.slice(-4) : name;
}

// The Content-Disposition for showing a CV in the browser: a plain ASCII name for old clients, and the real
// one, percent-encoded, for the rest. encodeURIComponent leaves ' ( ) * alone, which RFC 5987 doesn't allow.
function cvDisposition(fileName: string): string {
	const ascii = fileName.replace(/[^A-Za-z0-9._ -]/gu, "_");
	const encoded = encodeURIComponent(fileName).replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
	return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Starts a scoring run. If the Workflow won't start, the CV is failed with a retryable message
// instead of sitting queued forever, and the caller still gets the candidate back.
async function startScoring(env: Env, db: Db, requestId: string, candidate: Candidate, instanceId: string) {
	try {
		await env.SCORE_CV.create({ id: instanceId, params: { candidateId: candidate.id } });
		return candidate;
	} catch (error) {
		console.error(`[${requestId}] scoring did not start for ${candidate.id}`, error);
		return (await markStartFailed(db, candidate.id)) ?? candidate;
	}
}

// A job's CVs. Mounted inside jobRoutes, so they sit behind its session and company checks.
export function candidateRoutes() {
	const routes = new Hono<AppEnv>().basePath("/:jobId/candidates");

	routes.get("/", async (c) => {
		const db = getDb(c.env.DB);
		const jobId = c.req.param("jobId");
		const cvCount = await getCvCount(db, c.get("org").id, jobId);
		if (cvCount === null) return c.json(jobNotFound, 404);

		const candidates = await listCandidates(db, c.get("org").id, jobId);
		return c.json({ candidates, cvCount, cvLimit: CV_LIMIT_PER_JOB }, 200, { "Cache-Control": "no-store" });
	});

	// The job's candidates as a spreadsheet, for any member of the company. Registered before "/:id" so the path is
	// not taken for a candidate. The file is built from one query: a CPU-light loop over the job's few hundred rows at most.
	routes.get("/export.csv", validQuery(exportQuery), async (c) => {
		const db = getDb(c.env.DB);
		const org = c.get("org");
		const jobId = c.req.param("jobId");
		const job = await getJob(db, org.id, jobId);
		if (!job) return c.json(jobNotFound, 404);

		const { decision } = c.req.valid("query");
		const rows = await listForExport(db, org.id, jobId, decision);
		return c.body(buildCsv(rows), 200, {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${exportFileName(job.title, decision)}"`,
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
	});

	// The body is the raw PDF. It is streamed straight into R2 and never buffered: a Worker on the free
	// plan has 10 ms of CPU, which parsing 5 MB would not fit in.
	routes.post("/", async (c) => {
		const org = c.get("org");
		const jobId = c.req.param("jobId");

		const fileName = cleanFileName(c.req.query("fileName"));
		const contentType = c.req.header("content-type")?.split(";")[0].trim().toLowerCase();
		if (contentType !== "application/pdf" || !fileName) {
			return c.json({ error: { code: "not_pdf", message: "Upload a PDF file" } }, 415);
		}
		const contentLength = c.req.header("content-length");
		if (!contentLength || !/^\d+$/.test(contentLength)) {
			return c.json({ error: { code: "length_required", message: "Upload the file again" } }, 411);
		}
		const fileSize = Number(contentLength);
		if (fileSize > CV_MAX_BYTES) {
			return c.json({ error: { code: "too_large", message: "Each CV must be 5 MB or smaller" } }, 413);
		}
		if (fileSize === 0) {
			return c.json({ error: { code: "empty_file", message: "That file is empty" } }, 400);
		}

		const db = getDb(c.env.DB);
		const slot = await takeSlot(db, org.id, jobId);
		if (!slot.ok) {
			if (slot.reason === "job_not_found") return c.json(jobNotFound, 404);
			if (slot.reason === "job_not_open") {
				return c.json(
					{ error: { code: "job_not_open", message: "This job isn't open, so it can't take CVs. Open it first." } },
					409,
				);
			}
			return c.json(
				{ error: { code: "cv_limit", message: `This job has used its ${CV_LIMIT_PER_JOB} free CVs` } },
				403,
			);
		}

		const id = crypto.randomUUID();
		const fileKey = `${org.id}/${jobId}/${id}.pdf`;
		try {
			await c.env.CVS.put(fileKey, c.req.raw.body, { httpMetadata: { contentType: "application/pdf" } });
		} catch (error) {
			console.error(`[${c.get("requestId")}] cv upload to R2 failed`, error);
			c.executionCtx.waitUntil(releaseSlot(db, org.id, jobId));
			return c.json({ error: { code: "upload_failed", message: "We couldn't store that file. Try again." } }, 502);
		}

		let candidate: Candidate;
		try {
			candidate = await createCandidate(db, {
				id,
				orgId: org.id,
				jobId,
				fileKey,
				fileName,
				fileSize,
				createdBy: c.get("userId"),
			});
		} catch (error) {
			// Don't leave a file nobody can see, or a slot nobody used.
			c.executionCtx.waitUntil(Promise.all([deleteCvFiles(c.env.CVS, [fileKey]), releaseSlot(db, org.id, jobId)]));
			throw error;
		}

		candidate = await startScoring(c.env, db, c.get("requestId"), candidate, id);
		return c.json({ candidate }, 201);
	});

	routes.get("/:id", async (c) => {
		const candidate = await getCandidate(getDb(c.env.DB), c.get("org").id, c.req.param("jobId"), c.req.param("id"));
		return candidate ? c.json({ candidate }, 200, { "Cache-Control": "no-store" }) : c.json(candidateNotFound, 404);
	});

	// Any member of the company may decide, admins and members alike. Only delete is for admins.
	routes.patch("/:id", validJson(decideInput), async (c) => {
		const candidate = await decideCandidate(
			getDb(c.env.DB),
			c.get("org").id,
			c.req.param("jobId"),
			c.req.param("id"),
			c.get("userId"),
			c.req.valid("json"),
		);
		return candidate ? c.json({ candidate }) : c.json(candidateNotFound, 404);
	});

	// The original PDF, streamed from R2 and never buffered. `no-store` keeps a CV out of shared caches.
	routes.get("/:id/cv", async (c) => {
		const file = await getCvFile(getDb(c.env.DB), c.get("org").id, c.req.param("jobId"), c.req.param("id"));
		if (!file) return c.json(candidateNotFound, 404);

		const object = await c.env.CVS.get(file.fileKey);
		if (!object) return c.json(fileMissing, 404);
		return c.body(object.body, 200, {
			"Content-Type": "application/pdf",
			"Content-Length": String(object.size),
			"Content-Disposition": cvDisposition(file.fileName),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		});
	});

	// Another scoring run for a CV that failed or got stuck, at most MAX_SCORING_RUNS in all.
	routes.post("/:id/retry", async (c) => {
		const db = getDb(c.env.DB);
		const id = c.req.param("id");
		const retry = await startRetry(db, c.get("org").id, c.req.param("jobId"), id);
		if (!retry.ok) {
			if (retry.reason === "candidate_not_found") return c.json(candidateNotFound, 404);
			if (retry.reason === "not_failed") {
				return c.json(
					{ error: { code: "not_failed", message: "Only a CV that failed or got stuck can be retried" } },
					409,
				);
			}
			return c.json(
				{
					error: {
						code: "retry_limit",
						message: `We've tried this CV ${MAX_SCORING_RUNS} times. It may not be a readable PDF.`,
					},
				},
				409,
			);
		}

		// Each run is its own Workflow instance, because an instance id can only be used once.
		const candidate = await startScoring(c.env, db, c.get("requestId"), retry.candidate, `${id}-${retry.runs}`);
		return c.json({ candidate }, 202);
	});

	// Deleting is for admins only, like jobs. The job keeps the slot: the upload already spent a Gemini call.
	routes.delete("/:id", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") {
			return c.json({ error: { code: "forbidden", message: "Only admins can delete candidates" } }, 403);
		}
		const fileKey = await deleteCandidate(getDb(c.env.DB), org.id, c.req.param("jobId"), c.req.param("id"));
		if (!fileKey) return c.json(candidateNotFound, 404);

		c.executionCtx.waitUntil(deleteCvFiles(c.env.CVS, [fileKey]));
		return c.body(null, 204);
	});

	return routes;
}
