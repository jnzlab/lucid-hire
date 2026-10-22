import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "../../jobs/jobs-page.tsx";

export const Route = createFileRoute("/dashboard/")({
	component: JobsPage,
});
