// Browser origins allowed to call the API (CORS) and to present Clerk session tokens (the token's `azp`).
// The live app uses the production Clerk instance; local dev on :5173 uses the development instance.
export const ALLOWED_ORIGINS = ["https://lucidhire.io", "http://localhost:5173"];
