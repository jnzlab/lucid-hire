// Production builds talk to the live API and the production Clerk instance, which only works on
// lucidhire.io. Local dev (`pnpm dev:web` + `pnpm dev:api`) uses the API on :8787 and the
// development Clerk instance. Publishable keys are public by design.
const isProduction = import.meta.env.PROD;

export const API_URL = isProduction ? "https://api.lucidhire.io" : "http://localhost:8787";

export const CLERK_PUBLISHABLE_KEY = isProduction
	? "pk_live_Y2xlcmsubHVjaWRoaXJlLmlvJA"
	: "pk_test_YXdhaXRlZC1yYXZlbi0xNS5jbGVyay5hY2NvdW50cy5kZXYk";

// Cloudflare Turnstile on the public apply form. Site keys are public by design. Dev uses Cloudflare's always-pass
// test key; the "lucid-hire" widget works on lucidhire.io (and localhost).
export const TURNSTILE_SITE_KEY = isProduction ? "0x4AAAAAADeCVl5Dw1k8zp0i" : "1x00000000000000000000AA";
