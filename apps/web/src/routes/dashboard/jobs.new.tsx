import { createFileRoute } from "@tanstack/react-router";
import { NewJobPage } from "../../jobs/new-job-page.tsx";

export const Route = createFileRoute("/dashboard/jobs/new")({
	component: NewJobPage,
});
