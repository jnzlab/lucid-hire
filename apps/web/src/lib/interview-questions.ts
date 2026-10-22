import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "./api.ts";
import { useSession } from "./session.ts";

// What the API sends (apps/api/src/interview-questions.ts). `focus` is 1 to 4 words, usually a requirement label.
export type InterviewQuestion = { question: string; focus: string };
// Both are null until questions have been written for the candidate.
export type QuestionSet = { questions: InterviewQuestion[] | null; generatedAt: string | null };

// Keyed by user, like the candidates.
const questionsKey = (userId: string | null | undefined, jobId: string, id: string) =>
	["questions", userId, jobId, id] as const;

const questionsPath = (jobId: string, id: string) => `/jobs/${jobId}/candidates/${id}/questions`;

// The saved questions. `enabled` is off until the candidate is scored, when there can be none to ask for.
export function useInterviewQuestions(jobId: string, id: string, enabled: boolean) {
	const { userId, token } = useSession();
	return useQuery({
		queryKey: questionsKey(userId, jobId, id),
		enabled,
		queryFn: async ({ signal }) => apiGet<QuestionSet>(questionsPath(jobId, id), { token: await token(), signal }),
		retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status === 404),
	});
}

// Has Gemini write a new set, which takes 10 to 30 seconds and replaces the saved one.
export function useWriteQuestions(jobId: string, id: string) {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () =>
			apiPost<QuestionSet>(questionsPath(jobId, id), undefined, { token: await token() }),
		onSuccess: (set) => queryClient.setQueryData(questionsKey(userId, jobId, id), set),
	});
}
