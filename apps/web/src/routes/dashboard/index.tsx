import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../../overview/overview-page.tsx";

// The first page after sign-in. The jobs list lives at /dashboard/jobs.
export const Route = createFileRoute("/dashboard/")({
	component: OverviewPage,
});
