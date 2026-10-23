import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "../../jobs/jobs-page.tsx";
import { JOB_SEARCH_MAX, JOB_SORTS, type JobFilters } from "../../lib/jobs.ts";

// The jobs list keeps its filters in the address. Anything unreadable is dropped, so a bad link shows the plain list.
// Every sort the API takes is accepted, including "candidates", which the menu no longer offers but old links use.
export const Route = createFileRoute("/dashboard/jobs/")({
	validateSearch: (search): JobFilters => {
		const q = typeof search.q === "string" ? search.q.trim().slice(0, JOB_SEARCH_MAX) : "";
		const page = Number(search.page);
		return {
			q: q || undefined,
			status: search.status === "open" || search.status === "draft" || search.status === "closed" ? search.status : undefined,
			sort: JOB_SORTS.find((sort) => sort !== "newest" && sort === search.sort) as JobFilters["sort"],
			page: Number.isInteger(page) && page > 1 ? page : undefined,
		};
	},
	component: JobsPage,
});
