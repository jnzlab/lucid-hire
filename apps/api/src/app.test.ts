import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SessionVerifier } from "./auth.ts";
import { createTestD1 } from "./test/d1.ts";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
	const testD1 = await createTestD1();
	env = { CLERK_SECRET_KEY: "sk_test_unit", DB: testD1.d1 } as Env;
	dispose = testD1.dispose;
});

afterAll(() => dispose());

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

	it("returns the signed-in user, with no company before onboarding", async () => {
		const res = await app.request("/me", { headers: { authorization: "Bearer good-token" } }, env);

		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({ userId: "user_123", org: null });
	});
});

describe("POST /orgs", () => {
	const post = (body: unknown, authorization = "Bearer good-token") =>
		app.request(
			"/orgs",
			{
				method: "POST",
				headers: { authorization, "content-type": "application/json" },
				body: typeof body === "string" ? body : JSON.stringify(body),
			},
			env,
		);

	it("requires a session", async () => {
		const res = await post({ name: "Acme" }, "");

		expect(res.status).toBe(401);
	});

	it("rejects a missing, too short or unparseable name", async () => {
		for (const body of [{}, { name: " A " }, { name: 7 }, "not json"]) {
			const res = await post(body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "invalid_name" } });
		}
	});

	it("creates the company once, then returns it, and /me reports it", async () => {
		const created = await post({ name: "  Acme   Hiring " });
		expect(created.status).toBe(201);
		const { org } = (await created.json()) as { org: { id: string } };
		expect(org).toMatchObject({ name: "Acme Hiring", role: "admin" });

		const repeated = await post({ name: "Another Name" });
		expect(repeated.status).toBe(200);
		expect(await repeated.json()).toEqual({ org });

		const me = await app.request("/me", { headers: { authorization: "Bearer good-token" } }, env);
		expect(await me.json()).toEqual({ userId: "user_123", org });
	});
});

describe("unknown routes", () => {
	it("answer with a JSON 404", async () => {
		const res = await app.request("/nope", {}, env);

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
	});
});
