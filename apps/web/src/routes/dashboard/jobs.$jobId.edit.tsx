import { createFileRoute } from "@tanstack/react-router";
import { EditJobPage } from "../../jobs/edit-job-page.tsx";

export const Route = createFileRoute("/dashboard/jobs/$jobId/edit")({
	component: function EditJobRoute() {
		return <EditJobPage jobId={Route.useParams().jobId} />;
	},
});
