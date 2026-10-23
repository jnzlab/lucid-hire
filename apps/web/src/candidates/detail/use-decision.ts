import { useQueryClient } from "@tanstack/react-query";
import { allCandidatesKey } from "../../lib/all-candidates.ts";
import { type Candidate, type Decision, candidateName, useDecideCandidate } from "../../lib/candidates.ts";
import { jobsKey } from "../../lib/jobs.ts";
import { overviewKey } from "../../lib/overview.ts";
import { useSession } from "../../lib/session.ts";
import { useToast } from "../../ui/use-toast.ts";

// What the toast says after a decision.
export function decisionMessage(decision: Decision, name: string): string {
	if (decision === "shortlisted") return `Shortlisted ${name}`;
	if (decision === "rejected") return `Marked ${name} as not a fit`;
	return `Marked ${name} as undecided`;
}

// Shortlists, rejects or un-decides one candidate. The change shows at once (useDecideCandidate puts it back if the
// API refuses), a toast says what happened with an Undo that puts the previous decision back, and whatever counts
// decisions elsewhere (the sidebar's "to review", the jobs list, the candidates page) asks again afterwards.
export function useDecision(jobId: string, candidate: Candidate) {
	const decide = useDecideCandidate(jobId, candidate.id);
	const toast = useToast();
	const queryClient = useQueryClient();
	const { userId } = useSession();
	const name = candidateName(candidate);

	const refreshAround = () => {
		for (const queryKey of [overviewKey(userId), jobsKey(userId), allCandidatesKey(userId)]) {
			void queryClient.invalidateQueries({ queryKey });
		}
	};
	// mutateAsync, not mutate: its promise settles even when the panel has moved on to another candidate, so the
	// counts still refresh and an undo from a toast still lands.
	const send = (decision: Decision) => decide.mutateAsync({ decision }).finally(refreshAround);

	// `opening` goes before the message ("Gmail draft opened. ").
	const choose = (decision: Decision, opening = "") => {
		const previous = candidate.decision;
		if (decision === previous) return;
		const toastId = toast.show({
			message: `${opening}${decisionMessage(decision, name)}`,
			action: { label: "Undo", onClick: () => void send(previous).catch(() => {}) },
		});
		// A refused change is put back and explained beside the controls; the toast would say it happened.
		send(decision).catch(() => toast.dismiss(toastId));
	};

	return {
		choose,
		error: decide.isError ? decide.error.message : null,
		clearError: () => decide.reset(),
	};
}
