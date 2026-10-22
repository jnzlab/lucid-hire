import { createFileRoute } from "@tanstack/react-router";
import { CandidatePage } from "../../candidates/candidate-page.tsx";

export const Route = createFileRoute("/dashboard/jobs/$jobId/candidates/$candidateId")({
	component: function CandidateRoute() {
		const { jobId, candidateId } = Route.useParams();
		return <CandidatePage jobId={jobId} candidateId={candidateId} />;
	},
});
