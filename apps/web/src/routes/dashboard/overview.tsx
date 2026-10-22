import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../../overview/overview-page.tsx";

export const Route = createFileRoute("/dashboard/overview")({
	component: OverviewPage,
});
