import type { PaidPlanKey } from "@lucid-hire/plans";
import { z } from "zod";
import { POLAR } from "./config.ts";

// Polar webhooks follow the Standard Webhooks format: HMAC-SHA256 over `${id}.${timestamp}.${body}`, sent as
// space-separated `v1,<base64>` entries in `webhook-signature`.
const TOLERANCE_SECONDS = 5 * 60;

const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

export type SignatureCheck = "ok" | "bad_signature" | "stale_timestamp";

// The key is the UTF-8 bytes of the whole secret string, which is what Polar's SDK ends up using (it base64-encodes the
// secret and Standard Webhooks decodes it again). `subtle.verify` compares in constant time.
export async function verifyWebhook(
	secret: string,
	headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
	body: string,
	nowMs: number = Date.now(),
): Promise<SignatureCheck> {
	const { id, timestamp, signature } = headers;
	if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return "bad_signature";
	if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return "stale_timestamp";

	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
	const signed = encoder.encode(`${id}.${timestamp}.${body}`);
	for (const entry of signature.split(" ")) {
		const [version, value] = entry.split(",");
		const bytes = version === "v1" && value ? fromBase64(value) : null;
		if (bytes && (await crypto.subtle.verify("HMAC", key, bytes, signed))) return "ok";
	}
	return "bad_signature";
}

// Signs a body the way Polar does. Used by the tests.
export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`)));
	return `v1,${btoa(String.fromCharCode(...mac))}`;
}

export function planForProduct(productId: string | null | undefined): PaidPlanKey | null {
	if (productId === POLAR.products.pro) return "pro";
	if (productId === POLAR.products.max) return "max";
	return null;
}

export function productForPlan(plan: PaidPlanKey): string {
	return POLAR.products[plan];
}

const optionalString = z.string().nullish();

// The parts of Polar's subscription object we use. Polar's SDK renames fields to camelCase, but the wire format is
// snake_case, which is what the webhook sends.
export const subscriptionData = z.object({
	id: z.string().min(1),
	status: z.string().min(1),
	current_period_end: optionalString,
	cancel_at_period_end: z.boolean().nullish(),
	modified_at: optionalString,
	created_at: optionalString,
	product_id: optionalString,
	product: z.object({ id: z.string() }).nullish(),
	customer_id: optionalString,
	customer: z.object({ id: z.string().nullish(), external_id: optionalString }).nullish(),
	metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type SubscriptionData = z.infer<typeof subscriptionData>;

export const orderData = z.object({
	id: z.string().min(1),
	subscription_id: optionalString,
	status: optionalString,
});

export const webhookEnvelope = z.object({ type: z.string().min(1), timestamp: optionalString, data: z.unknown() });

export const SUBSCRIPTION_EVENTS = [
	"subscription.created",
	"subscription.updated",
	"subscription.active",
	"subscription.canceled",
	"subscription.uncanceled",
	"subscription.revoked",
	"subscription.past_due",
] as const;

// Calls Polar's REST API with the organization access token.
export type PolarFetch = (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;

export function polarFetcher(token: string): PolarFetch {
	return (path, init = {}) =>
		fetch(`${POLAR.apiBase}${path}`, {
			method: init.method ?? "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
}
