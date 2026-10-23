import { createFileRoute } from "@tanstack/react-router";
import { CandidatePage } from "../../candidates/candidate-page.tsx";
import { validateCandidateSearch } from "../../candidates/detail/job-view.ts";

// The job page's filter, search and sort come along in the address (`show`, `q`, `sort`), so previous and next walk
// the list the recruiter came from and the breadcrumb goes back to it.
export const Route = createFileRoute("/dashboard/jobs/$jobId/candidates/$candidateId")({
	validateSearch: validateCandidateSearch,
	component: function CandidateRoute() {
		const { jobId, candidateId } = Route.useParams();
		return <CandidatePage jobId={jobId} candidateId={candidateId} />;
	},
});
