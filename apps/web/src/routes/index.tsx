import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../landing/landing-page.tsx";

export const Route = createFileRoute("/")({
	component: LandingPage,
});
