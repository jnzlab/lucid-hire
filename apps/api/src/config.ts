// Browser origins allowed to call the API (CORS) and to present Clerk session tokens (the token's `azp`).
// The live app uses the production Clerk instance; local dev on :5173 uses the development instance.
export const ALLOWED_ORIGINS = ["https://lucidhire.io", "http://localhost:5173"];

// Polar, the billing provider. Sandbox for now: its own API host, products and test cards. Checkout and the
// customer portal are hosted by Polar. Not secrets, so they live here; the access token and the webhook secret
// are Worker secrets (cloudflare.config.ts).
export const POLAR = {
	server: "sandbox",
	apiBase: "https://sandbox-api.polar.sh/v1",
	products: {
		pro: "8947d0a6-59f8-4d3e-bb08-ec8aa8d25844",
		max: "fa0b6323-9ff1-44ae-a7d1-ca492d331424",
	},
} as const;

// Where Polar sends people back to after paying, and the web app's origin for each environment. The browser's own
// origin is used when it is one we allow.
export const APP_ORIGIN = "https://lucidhire.io";
export const DEV_APP_ORIGIN = "http://localhost:5173";
