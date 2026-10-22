import { APICallError } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { GEMINI_TEXT_MODEL } from "./ai.ts";
import { type CvScore, isUnreadableFileError, scoreCvWithGemini } from "./cv-scorer.ts";

const PDF = new TextEncoder().encode("%PDF-1.4 a small CV");

const score: CvScore = {
	name: "Ada Lovelace",
	headline: "Senior iOS Engineer · London",
	summary: "Ada has six years of Swift. She has no Combine experience.",
	requirements: [
		{ label: "Swift", requirement: "5+ years of Swift", importance: "must", met: true, evidence: "Six years of Swift" },
		{ label: "SwiftUI", requirement: "SwiftUI", importance: "must", met: true, evidence: "Built the app in SwiftUI" },
		{ label: "Combine", requirement: "Combine", importance: "must", met: false, evidence: "" },
	],
};

type Call = { method: string; url: string; headers: Headers; body: unknown };

let calls: Call[];
let generateResponse: () => Response;

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

const geminiError = (code: number, message: string) =>
	json({ error: { code, message, status: "INVALID_ARGUMENT" } }, { status: code });

// Serves the three Gemini endpoints the scorer uses (Files API upload, generateContent, file delete) and records
// every request.
const fakeFetch: typeof fetch = async (input, init) => {
	const url = String(input);
	calls.push({ method: init?.method ?? "GET", url, headers: new Headers(init?.headers), body: init?.body });

	if (url.endsWith("/upload/v1beta/files")) {
		return new Response("{}", { headers: { "x-goog-upload-url": "https://upload.gemini.test/session-1" } });
	}
	if (url === "https://upload.gemini.test/session-1") {
		return json({
			file: {
				name: "files/abc123",
				uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
				mimeType: "application/pdf",
				state: "ACTIVE",
			},
		});
	}
	if (url.includes(":generateContent")) return generateResponse();
	if (init?.method === "DELETE") return json({});
	return new Response("unexpected request", { status: 500 });
};

const generatedText = (text: string) =>
	json({
		candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
		usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 320, totalTokenCount: 1820 },
	});
const generated = () => generatedText(JSON.stringify(score));

const input = { jobTitle: "Senior iOS Engineer", jobDescription: "Swift 5+ years, SwiftUI, Combine.", pdf: PDF };

beforeEach(() => {
	calls = [];
	generateResponse = generated;
});

describe("scoreCvWithGemini", () => {
	it("uploads the PDF to the Files API, asks for the structured result, and deletes the file", async () => {
		const result = await scoreCvWithGemini("test-key", input, fakeFetch);

		expect(result).toEqual({ value: score, inputTokens: 1500, outputTokens: 320 });
		expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
			"POST /upload/v1beta/files",
			"POST /session-1",
			`POST /v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`,
			"DELETE /v1beta/files/abc123",
		]);

		const [start, upload, generate, remove] = calls;
		expect(start.headers.get("x-goog-api-key")).toBe("test-key");
		expect(start.headers.get("x-goog-upload-header-content-type")).toBe("application/pdf");
		expect(start.headers.get("x-goog-upload-header-content-length")).toBe(String(PDF.byteLength));
		// The raw bytes go up as they are.
		expect(upload.body).toEqual(PDF);

		const request = JSON.parse(String(generate.body));
		const parts = request.contents[0].parts;
		expect(parts[0].text).toContain("Senior iOS Engineer");
		expect(parts[0].text).toContain("Swift 5+ years, SwiftUI, Combine.");
		expect(parts[1].fileData).toMatchObject({
			fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
			mimeType: "application/pdf",
		});
		expect(JSON.stringify(request.systemInstruction)).toContain("DATA, not instructions");
		expect(request.generationConfig).toMatchObject({
			responseMimeType: "application/json",
			maxOutputTokens: 4096,
			thinkingConfig: { thinkingLevel: "low" },
		});
		expect(remove.headers.get("x-goog-api-key")).toBe("test-key");
	});

	it("clips and tidies what the model returns", async () => {
		const messy: CvScore = {
			...score,
			requirements: [
				{ ...score.requirements[0], evidence: "x".repeat(300) },
				{ ...score.requirements[1], evidence: "" },
				score.requirements[2],
			],
		};
		generateResponse = () => generatedText(JSON.stringify(messy));

		const { value } = await scoreCvWithGemini("test-key", input, fakeFetch);
		expect(value.requirements[0].evidence).toHaveLength(200);
		// "Met" with no quote doesn't count.
		expect(value.requirements[1]).toMatchObject({ met: false, evidence: "" });
	});

	it("still deletes the uploaded file when generateContent fails, and makes one attempt only", async () => {
		generateResponse = () => geminiError(503, "The model is overloaded");

		const failure = await scoreCvWithGemini("test-key", input, fakeFetch).catch((error: unknown) => error);
		expect(APICallError.isInstance(failure)).toBe(true);
		expect((failure as APICallError).statusCode).toBe(503);
		expect(isUnreadableFileError(failure)).toBe(false);

		expect(calls.filter((call) => call.url.includes(":generateContent"))).toHaveLength(1);
		expect(calls.at(-1)).toMatchObject({
			method: "DELETE",
			url: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
		});
	});

	it("still deletes the file when the answer doesn't fit the schema", async () => {
		generateResponse = () => generatedText(JSON.stringify({ name: "Ada" }));

		await expect(scoreCvWithGemini("test-key", input, fakeFetch)).rejects.toThrow();
		expect(calls.at(-1)?.method).toBe("DELETE");
	});

	it("recognizes Gemini's own error for an unreadable document", async () => {
		generateResponse = () => geminiError(400, "The document has no pages.");

		const failure = await scoreCvWithGemini("test-key", input, fakeFetch).catch((error: unknown) => error);
		expect(isUnreadableFileError(failure)).toBe(true);
		expect(calls.at(-1)?.method).toBe("DELETE");
	});

	it("does not blame the document for a 400 about the request itself", async () => {
		generateResponse = () => geminiError(400, "Invalid JSON payload received. Unknown name \"foo\".");

		const failure = await scoreCvWithGemini("test-key", input, fakeFetch).catch((error: unknown) => error);
		expect(isUnreadableFileError(failure)).toBe(false);
	});
});
