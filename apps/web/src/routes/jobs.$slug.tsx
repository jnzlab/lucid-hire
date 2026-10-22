import { createFileRoute } from "@tanstack/react-router";
import { PublicJobPage } from "../public/public-job-page.tsx";

// The public page for one job: no session needed.
export const Route = createFileRoute("/jobs/$slug")({
	component: function PublicJobRoute() {
		return <PublicJobPage slug={Route.useParams().slug} />;
	},
});
