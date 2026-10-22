import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "../onboarding/onboarding-page.tsx";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingPage,
});
