import { useRouter } from "@tanstack/react-router";
import type { JobFilters } from "../../lib/jobs.ts";

// The address of a view of the jobs list, built by the router so the search round-trips exactly as navigate writes
// it (a plain link would get "123" back as a number). For links rather than buttons: they open in a new tab too.
export function useJobsHref() {
	const router = useRouter();
	return (search: JobFilters) => router.buildLocation({ to: "/dashboard/jobs", search }).href;
}
