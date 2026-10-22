import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";

const env = { CLERK_SECRET_KEY: "sk_test_unit" } as Env;

const acceptOnlyGoodToken: SessionVerifier = async (token) => {
	if (token !== "good-token") throw new Error("invalid token");
	return { userId: "user_123" };
};

const app = createApp({ verifySession: acceptOnlyGoodToken });

describe("GET /health", () => {
	it("reports the service as up without caching", async () => {
		const res = await app.request("/health", {}, env);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, service: "lucidhire-api" });
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-request-id")).toBeTruthy();
	});

	it("echoes a well-formed request id and replaces a malformed one", async () => {
		const kept = await app.request("/health", { headers: { "x-request-id": "abc-123" } }, env);
		expect(kept.headers.get("x-request-id")).toBe("abc-123");

		const replaced = await app.request("/health", { headers: { "x-request-id": "bad id!" } }, env);
		expect(replaced.headers.get("x-request-id")).not.toBe("bad id!");
	});
});

describe("CORS", () => {
	it("allows the live app origin, including the preflight for an authorized request", async () => {
		const res = await app.request(
			"/me",
			{
				method: "OPTIONS",
				headers: {
					origin: "https://lucidhire.io",
					"access-control-request-method": "GET",
					"access-control-request-headers": "authorization",
				},
			},
			env,
		);

		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("https://lucidhire.io");
		expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
	});

	it("does not grant other origins", async () => {
		const res = await app.request("/health", { headers: { origin: "https://evil.example" } }, env);

		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("GET /me", () => {
	it("rejects a request without a bearer token", async () => {
		const res = await app.request("/me", {}, env);

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
	});

	it("rejects an invalid session token", async () => {
		const res = await app.request("/me", { headers: { authorization: "Bearer forged" } }, env);

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { code: "invalid_session" } });
	});

	it("returns the signed-in user for a valid session token", async () => {
		const res = await app.request("/me", { headers: { authorization: "Bearer good-token" } }, env);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ userId: "user_123" });
	});
});

describe("unknown routes", () => {
	it("answer with a JSON 404", async () => {
		const res = await app.request("/nope", {}, env);

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
	});
});
