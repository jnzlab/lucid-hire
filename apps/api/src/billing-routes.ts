import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { getBilling } from "./billing.ts";
import { type UserDirectory } from "./clerk.ts";
import { ALLOWED_ORIGINS, APP_ORIGIN } from "./config.ts";
import { requireOrg } from "./auth.ts";
import { getDb } from "./db/client.ts";
import { isPlanKey } from "@lucid-hire/plans";
import { ACCESS_STATUSES, getPlanState } from "./plan-state.ts";
import { type PolarFetch, productForPlan } from "./polar.ts";
import type { AppEnv } from "./types.ts";
import { validJson } from "./validation.ts";

const checkoutInput = z.object({ plan: z.enum(["pro", "max"], { error: "Choose Pro or Max" }) });

const forbidden = {
	error: { code: "forbidden", message: "Only admins can change the plan or open billing" },
};
const unavailable = {
	error: { code: "billing_unavailable", message: "We couldn't reach the billing provider. Try again in a moment." },
};

type BillingRouteOptions = {
	auth: MiddlewareHandler<AppEnv>;
	polar: (env: Env) => PolarFetch;
	directory: UserDirectory;
};

// Plan, usage and billing. Anyone in the company can read; changing the plan is for admins.
export function billingRoutes({ auth, polar, directory }: BillingRouteOptions) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/", async (c) => {
		const org = c.get("org");
		const billing = await getBilling(getDb(c.env.DB), org.id);
		return c.json({ ...billing, isAdmin: org.role === "admin" }, 200, { "Cache-Control": "no-store" });
	});

	// Opens a Polar checkout. A company that already pays gets its subscription CHANGED instead, so an upgrade can
	// never create a second subscription and bill twice (B2).
	routes.post("/checkout", validJson(checkoutInput), async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(forbidden, 403);
		const { plan } = c.req.valid("json");
		const db = getDb(c.env.DB);
		const state = await getPlanState(db, org.id);
		const polarApi = polar(c.env);

		// Anyone with a live subscription changes it in place. Live means its stored status still gives access, even
		// when its period end has passed: the renewal webhook may be late, and a second checkout would bill twice.
		const live = (ACCESS_STATUSES as readonly string[]).includes(state?.subscriptionStatus ?? "");
		if (state?.polarSubscriptionId && live && isPlanKey(state.plan) && state.plan !== "free") {
			if (state.subscriptionStatus === "past_due") {
				return c.json(
					{ error: { code: "payment_overdue", message: "Your last payment failed. Fix it in the billing portal first." } },
					409,
				);
			}
			if (state.cancelAtPeriodEnd) {
				return c.json(
					{ error: { code: "cancel_pending", message: "Your plan is set to end. Undo that in the billing portal first." } },
					409,
				);
			}
			if (state.plan === plan) {
				return c.json({ error: { code: "same_plan", message: `You're already on ${plan === "pro" ? "Pro" : "Max"}.` } }, 409);
			}
			const res = await polarApi(`/subscriptions/${encodeURIComponent(state.polarSubscriptionId as string)}`, {
				method: "PATCH",
				body: { product_id: productForPlan(plan), proration_behavior: "invoice" },
			});
			if (!res.ok) {
				console.error(`[${c.get("requestId")}] polar subscription change failed`, res.status, await res.text().catch(() => ""));
				return c.json(unavailable, 502);
			}
			// The webhook will move the stored plan; the page polls until it does.
			return c.json({ changed: true, plan });
		}
		const user = (await directory(c.env, [c.get("userId")]).catch(() => new Map())).get(c.get("userId"));
		const origin = ALLOWED_ORIGINS.includes(c.req.header("origin") ?? "") ? (c.req.header("origin") as string) : APP_ORIGIN;
		const res = await polarApi("/checkouts/", {
			method: "POST",
			body: {
				products: [productForPlan(plan)],
				external_customer_id: org.id,
				...(user?.email ? { customer_email: user.email } : {}),
				metadata: { org_id: org.id },
				success_url: `${origin}/dashboard/settings?checkout=success`,
			},
		});
		const body = (await res.json().catch(() => null)) as { url?: string } | null;
		if (!res.ok || !body?.url) {
			console.error(`[${c.get("requestId")}] polar checkout failed`, res.status);
			return c.json(unavailable, 502);
		}
		return c.json({ url: body.url });
	});

	// Polar's customer portal: invoices, payment method, downgrade and cancel.
	routes.post("/portal", async (c) => {
		const org = c.get("org");
		if (org.role !== "admin") return c.json(forbidden, 403);
		const state = await getPlanState(getDb(c.env.DB), org.id);
		if (!state?.polarCustomerId) {
			return c.json({ error: { code: "no_billing", message: "There is no billing to manage yet. Upgrade first." } }, 409);
		}

		const res = await polar(c.env)("/customer-sessions/", {
			method: "POST",
			body: { external_customer_id: org.id },
		});
		const body = (await res.json().catch(() => null)) as { customer_portal_url?: string } | null;
		if (!res.ok || !body?.customer_portal_url) {
			console.error(`[${c.get("requestId")}] polar portal failed`, res.status);
			return c.json(unavailable, 502);
		}
		return c.json({ url: body.customer_portal_url });
	});

	return routes;
}

