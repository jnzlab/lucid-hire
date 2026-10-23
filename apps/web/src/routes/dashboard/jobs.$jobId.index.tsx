import { createFileRoute } from "@tanstack/react-router";
import { JobPage } from "../../jobs/job-page.tsx";
import { validateJobSearch } from "../../jobs/workspace/view.ts";

// The job's triage workspace keeps its tab, filter, search, sort and selected candidate in the address.
export const Route = createFileRoute("/dashboard/jobs/$jobId/")({
	validateSearch: validateJobSearch,
	component: function JobRoute() {
		return <JobPage jobId={Route.useParams().jobId} />;
	},
});
