import { createFileRoute } from "@tanstack/react-router";
import { AllCandidatesPage } from "../../all-candidates/all-candidates-page.tsx";
import { validateAllCandidatesSearch } from "../../lib/all-candidates.ts";

// Every candidate across the company's jobs. The filters live in the address, and anything unreadable is dropped,
// so a bad link shows the plain list.
export const Route = createFileRoute("/dashboard/candidates")({
	validateSearch: validateAllCandidatesSearch,
	component: AllCandidatesPage,
});
