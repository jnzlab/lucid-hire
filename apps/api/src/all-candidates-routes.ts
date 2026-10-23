import { Hono, type MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { ALL_CANDIDATES_PAGE_SIZE, allCandidatesQuery, listAllCandidates } from "./all-candidates.ts";
import { requireOrg } from "./auth.ts";
import { bulkDecideInput, bulkDeleteInput, decideCandidates, deleteCandidates, deleteCvFiles } from "./candidates.ts";
import { getDb } from "./db/client.ts";
import type { AppEnv } from "./types.ts";
import { validJson, validQuery } from "./validation.ts";

// Checked before the body is read, so a member is told no whatever they sent.
const adminsOnly = createMiddleware<AppEnv>(async (c, next) => {
	if (c.get("org").role !== "admin") {
		return c.json({ error: { code: "forbidden", message: "Only admins can delete candidates" } }, 403);
	}
	await next();
});

// The company's candidates across all its jobs: the candidates page, and bulk actions that may span jobs. A job's own
// list stays at /jobs/:jobId/candidates.
export function allCandidateRoutes({ auth }: { auth: MiddlewareHandler<AppEnv> }) {
	const routes = new Hono<AppEnv>();
	routes.use(auth, requireOrg);

	// ?q=, ?jobId=, ?decision=, ?status=, ?minScore=, ?sort= and ?page=, 50 candidates to a page.
	routes.get("/", validQuery(allCandidatesQuery), async (c) => {
		const query = c.req.valid("query");
		const { candidates, total, counts } = await listAllCandidates(getDb(c.env.DB), c.get("org").id, query);
		return c.json({ candidates, total, page: query.page, pageSize: ALL_CANDIDATES_PAGE_SIZE, counts }, 200, {
			"Cache-Control": "no-store",
		});
	});

	// One decision for up to 200 CVs, for any member, like the single PATCH. Ids that aren't the company's are skipped;
	// the answer lists the CVs whose decision changed, with what it was, so the page can offer an undo.
	routes.post("/decisions", validJson(bulkDecideInput), async (c) => {
		const { ids, decision } = c.req.valid("json");
		const updated = await decideCandidates(getDb(c.env.DB), c.get("org").id, ids, c.get("userId"), decision);
		return c.json({ updated });
	});

	// Deletes up to 200 CVs and their files, for admins only. The jobs keep their slots, as with a single delete.
	routes.post("/delete", adminsOnly, validJson(bulkDeleteInput), async (c) => {
		const deleted = await deleteCandidates(getDb(c.env.DB), c.get("org").id, c.req.valid("json").ids);
		c.executionCtx.waitUntil(deleteCvFiles(c.env.CVS, deleted.map((row) => row.fileKey)));
		return c.json({ deleted: deleted.map(({ id, jobId }) => ({ id, jobId })) });
	});

	return routes;
}
