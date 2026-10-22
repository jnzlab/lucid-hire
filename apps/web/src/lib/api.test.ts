import { afterEach, describe, expect, it, vi } from "vitest";
import { stubXhr } from "../test/fake-xhr.ts";
import {
	ApiError,
	NETWORK_ERROR_MESSAGE,
	SERVER_ERROR_MESSAGE,
	apiGet,
	apiGetBlob,
	apiPost,
	apiUploadPdf,
} from "./api.ts";

afterEach(() => vi.unstubAllGlobals());

const answerWith = (response: () => Response) => vi.stubGlobal("fetch", vi.fn(async () => response()));
const failWith = (error: unknown) =>
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw error;
		}),
	);
const rejection = (call: Promise<unknown>) => call.then(() => null, (error: unknown) => error);

describe("API errors", () => {
	it("says in plain words when the API can't be reached, whichever call it was", async () => {
		failWith(new TypeError("Failed to fetch"));

		for (const call of [
			apiGet("/jobs"),
			apiPost("/jobs", {}),
			apiGetBlob("/jobs/job_1/candidates/cand_1/cv"),
		]) {
			const error = await rejection(call);
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).message).toBe("We couldn't reach LucidHire. Check your connection and try again.");
			expect((error as ApiError).message).toBe(NETWORK_ERROR_MESSAGE);
		}
	});

	it("lets a call the page cancelled keep its own error", async () => {
		const controller = new AbortController();
		const aborted = new DOMException("The operation was aborted.", "AbortError");
		failWith(aborted);
		controller.abort();

		expect(await rejection(apiGet("/jobs", { signal: controller.signal }))).toBe(aborted);
	});

	it("says it was on our side for a 5xx that has no message of its own", async () => {
		answerWith(() => new Response("<html>Bad gateway</html>", { status: 502 }));
		const error = (await rejection(apiGet("/jobs"))) as ApiError;
		expect(error.message).toBe("Something went wrong on our side. Try again.");
		expect(error.message).toBe(SERVER_ERROR_MESSAGE);
		expect(error.status).toBe(502);

		answerWith(() => new Response(null, { status: 500 }));
		expect(((await rejection(apiGet("/jobs"))) as ApiError).message).toBe(SERVER_ERROR_MESSAGE);
	});

	it("keeps the API's own message, and never shows a status line", async () => {
		answerWith(() => Response.json({ error: { code: "ai_failed", message: "We couldn't write questions right now." } }, { status: 500 }));
		const error = (await rejection(apiPost("/jobs/enhance", {}))) as ApiError;
		expect(error.message).toBe("We couldn't write questions right now.");
		expect(error.code).toBe("ai_failed");

		// A refusal with no message at all.
		answerWith(() => new Response("nope", { status: 403 }));
		const refused = (await rejection(apiGet("/jobs"))) as ApiError;
		expect(refused.message).toBe("Something went wrong. Try again.");
		expect(refused.message).not.toMatch(/Request failed|Failed to fetch/);
	});
});

describe("apiUploadPdf", () => {
	const pdf = () => new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" });

	it("sends the raw file with the token, reports progress and returns the JSON answer", async () => {
		const seen: unknown[] = [];
		stubXhr(async (request, progress) => {
			seen.push([request.method, request.url, request.headers, request.body.name]);
			progress(25, 100);
			progress(100, 100);
			return { status: 201, body: JSON.stringify({ candidate: { id: "cand_1" } }) };
		});
		const percents: number[] = [];

		const answer = await apiUploadPdf("/jobs/job_1/candidates?fileName=cv.pdf", pdf(), {
			token: "tok",
			onProgress: (percent) => percents.push(percent),
		});

		expect(answer).toEqual({ candidate: { id: "cand_1" } });
		expect(percents).toEqual([25, 100]);
		expect(seen).toEqual([
			[
				"POST",
				"http://localhost:8787/jobs/job_1/candidates?fileName=cv.pdf",
				{ "Content-Type": "application/pdf", Authorization: "Bearer tok" },
				"cv.pdf",
			],
		]);
	});

	it("throws the API's error, and says it was on our side for a 5xx with no message", async () => {
		stubXhr(async () => ({ status: 403, body: JSON.stringify({ error: { code: "cv_limit", message: "This job is full" } }) }));
		const refused = (await rejection(apiUploadPdf("/x", pdf()))) as ApiError;
		expect([refused.status, refused.code, refused.message]).toEqual([403, "cv_limit", "This job is full"]);

		stubXhr(async () => ({ status: 502, body: "<html>Bad gateway</html>" }));
		const bad = (await rejection(apiUploadPdf("/x", pdf()))) as ApiError;
		expect([bad.status, bad.message]).toEqual([502, SERVER_ERROR_MESSAGE]);
	});

	it("says in plain words when the API can't be reached", async () => {
		stubXhr(async () => {
			throw new Error("offline");
		});
		const error = (await rejection(apiUploadPdf("/x", pdf()))) as ApiError;
		expect(error).toBeInstanceOf(ApiError);
		expect([error.status, error.message]).toEqual([0, NETWORK_ERROR_MESSAGE]);
	});
});
