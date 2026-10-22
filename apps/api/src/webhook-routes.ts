import { Hono } from "hono";
import { getDb } from "./db/client.ts";
import { type PolarFetch, verifyWebhook, webhookEnvelope } from "./polar.ts";
import { BadPayload, RetryLater, handlePolarEvent, markHandled, wasHandled } from "./subscriptions.ts";
import type { AppEnv } from "./types.ts";

const error = (code: string, message: string) => ({ error: { code, message } });

// Polar's webhook endpoint. No Clerk session: the signature is the authentication. The status codes tell Polar what
// to do: 2xx stops it, 4xx/5xx makes it retry later.
export function webhookRoutes({ polar }: { polar: (env: Env) => PolarFetch }) {
	const routes = new Hono<AppEnv>();

	routes.post("/polar", async (c) => {
		const secret = c.env.POLAR_WEBHOOK_SECRET;
		if (!secret) {
			console.error(`[${c.get("requestId")}] POLAR_WEBHOOK_SECRET is not set`);
			return c.json(error("not_configured", "Webhooks are not configured"), 503);
		}

		const body = await c.req.text();
		const id = c.req.header("webhook-id");
		const check = await verifyWebhook(
			secret,
			{ id, timestamp: c.req.header("webhook-timestamp"), signature: c.req.header("webhook-signature") },
			body,
		);
		if (check !== "ok") {
			return c.json(
				error(check, check === "stale_timestamp" ? "The webhook timestamp is too old" : "The webhook signature is invalid"),
				401,
			);
		}

		let envelope: ReturnType<typeof webhookEnvelope.safeParse>;
		try {
			envelope = webhookEnvelope.safeParse(JSON.parse(body));
		} catch {
			return c.json(error("invalid_body", "The webhook body is not JSON"), 400);
		}
		if (!envelope.success || !id) return c.json(error("invalid_body", "The webhook body is not an event"), 400);

		const db = getDb(c.env.DB);
		if (await wasHandled(db, id)) return c.json({ ok: true, outcome: "duplicate" });

		try {
			const outcome = await handlePolarEvent(db, envelope.data, polar(c.env));
			// Unknown event types are answered 2xx so Polar stops retrying them; they are recorded like any other.
			await markHandled(db, id, envelope.data.type);
			const unknown = outcome.kind === "ignored" && outcome.reason === "unknown event type";
			return c.json({ ok: true, outcome: outcome.kind }, unknown ? 202 : 200);
		} catch (cause) {
			if (cause instanceof BadPayload) {
				console.error(`[${c.get("requestId")}] bad polar payload ${id}`, cause);
				return c.json(error("invalid_body", "The webhook payload is not usable"), 400);
			}
			// Not recorded, so Polar's retry is handled again: no company yet, Polar was unreachable, or another event won a race.
			console.error(`[${c.get("requestId")}] polar event ${id} will be retried`, cause);
			if (cause instanceof RetryLater) return c.json(error("retry_later", "Try this event again later"), 503);
			throw cause;
		}
	});

	return routes;
}
