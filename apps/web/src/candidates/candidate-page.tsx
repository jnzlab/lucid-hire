import { CandidateDetail } from "./candidate-detail.tsx";

// A candidate's own page: the full candidate detail across the content area, with the job's list one step back in
// the breadcrumbs and the previous and next candidate beside them.
export function CandidatePage({ jobId, candidateId }: { jobId: string; candidateId: string }) {
	return (
		<div className="wrap page max-w-[1440px]">
			<CandidateDetail jobId={jobId} candidateId={candidateId} mode="page" />
		</div>
	);
}
