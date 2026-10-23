import { Hono, type MiddlewareHandler } from "hono";
import { requireOrg } from "./auth.ts";
import { getDb } from "./db/client.ts";
import { searchInput, searchOrg } from "./search.ts";
import type { AppEnv } from "./types.ts";
import { validQuery } from "./validation.ts";

// The command palette's search across the company's jobs and candidates: ?q=, 1 to 100 characters.
export function searchRoutes({ auth }: { auth: MiddlewareHandler<AppEnv> }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/", validQuery(searchInput), async (c) =>
		c.json(await searchOrg(getDb(c.env.DB), c.get("org").id, c.req.valid("query").q), 200, { "Cache-Control": "no-store" }),
	);

	return routes;
}
