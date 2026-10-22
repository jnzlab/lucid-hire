import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "../onboarding/onboarding-page.tsx";
import { safeReturnPath } from "../lib/return-to.ts";

export const Route = createFileRoute("/onboarding")({
	validateSearch: (search: Record<string, unknown>) => ({ next: safeReturnPath(search.next) }),
	component: OnboardingPage,
});
