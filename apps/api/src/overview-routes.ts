import { Hono, type MiddlewareHandler } from "hono";
import { requireOrg } from "./auth.ts";
import { getDb } from "./db/client.ts";
import {
	getOverviewActivity,
	getOverviewAiMix,
	getOverviewFunnel,
	getOverviewKpis,
	getOverviewVelocity,
} from "./overview.ts";
import type { AppEnv } from "./types.ts";

const NO_STORE = { "Cache-Control": "no-store" };

// The company overview: one endpoint per card on the dashboard's overview page, so a slow or failing card
// never holds back the others.
export function overviewRoutes({ auth }: { auth: MiddlewareHandler<AppEnv> }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	routes.get("/kpis", async (c) => c.json(await getOverviewKpis(getDb(c.env.DB), c.get("org").id), 200, NO_STORE));
	routes.get("/velocity", async (c) =>
		c.json(await getOverviewVelocity(getDb(c.env.DB), c.get("org").id), 200, NO_STORE),
	);
	routes.get("/funnel", async (c) => c.json(await getOverviewFunnel(getDb(c.env.DB), c.get("org").id), 200, NO_STORE));
	routes.get("/ai-mix", async (c) => c.json(await getOverviewAiMix(getDb(c.env.DB), c.get("org").id), 200, NO_STORE));
	routes.get("/activity", async (c) =>
		c.json({ events: await getOverviewActivity(getDb(c.env.DB), c.get("org").id) }, 200, NO_STORE),
	);

	return routes;
}
