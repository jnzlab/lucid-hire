import { createFileRoute } from "@tanstack/react-router";
import { JobPage } from "../../jobs/job-page.tsx";

export const Route = createFileRoute("/dashboard/jobs/$jobId/")({
	component: function JobRoute() {
		return <JobPage jobId={Route.useParams().jobId} />;
	},
});
