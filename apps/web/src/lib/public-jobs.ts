import { useMutation, useQuery } from "@tanstack/react-query";
import { apiApply, apiGet } from "./api.ts";
import { API_URL } from "./config.ts";
import { CV_MAX_BYTES } from "./candidates.ts";

// A job as the public page sees it: no company id, no counts, nothing about recruiters.
export type PublicJob = {
	slug: string;
	title: string;
	description: string;
	status: "open" | "closed";
	company: string;
	createdAt: string;
	hasCover: boolean;
};

export const SUPPORT_EMAIL = "support@lucidhire.io";
export const PUBLIC_ORIGIN = "https://lucidhire.io";

export const publicJobUrl = (slug: string) => `${PUBLIC_ORIGIN}/jobs/${slug}`;
export const coverUrl = (slug: string, version?: string) =>
	`${API_URL}/public/jobs/${slug}/cover${version ? `?v=${encodeURIComponent(version)}` : ""}`;

export function usePublicJob(slug: string) {
	return useQuery({
		queryKey: ["public-job", slug],
		queryFn: async ({ signal }) => (await apiGet<{ job: PublicJob }>(`/public/jobs/${slug}`, { signal })).job,
		retry: (failures, error) => failures < 1 && !("status" in error && error.status === 404),
	});
}

// The same checks the API makes, in the same words.
export function checkApplicationFile(file: File): string | null {
	if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Upload your CV as a PDF file";
	if (file.size === 0) return "That file is empty";
	if (file.size > CV_MAX_BYTES) return "Your CV must be 5 MB or smaller";
	return null;
}

export const isValidEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);

export function useApply(slug: string) {
	return useMutation({
		mutationFn: (input: { email: string; file: File; captchaToken: string }) =>
			apiApply(`/public/jobs/${slug}/apply`, input.file, input),
	});
}
