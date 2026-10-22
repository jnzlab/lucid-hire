import { Hono, type MiddlewareHandler } from "hono";
import { requireOrg } from "./auth.ts";
import { getDb } from "./db/client.ts";
import { getOverview } from "./overview.ts";
import type { AppEnv } from "./types.ts";

// The company overview: numbers for the dashboard's overview page, in one response.
export function overviewRoutes({ auth }: { auth: MiddlewareHandler<AppEnv> }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/", async (c) => {
		const overview = await getOverview(getDb(c.env.DB), c.get("org").id);
		return c.json(overview, 200, { "Cache-Control": "no-store" });
	});

	return routes;
}
