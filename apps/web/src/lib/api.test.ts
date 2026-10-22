import { afterEach, describe, expect, it, vi } from "vitest";
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
			apiUploadPdf("/jobs/job_1/candidates", new File(["%PDF"], "cv.pdf")),
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
