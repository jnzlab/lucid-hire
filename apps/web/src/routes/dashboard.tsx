import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../dashboard/dashboard-page.tsx";

export const Route = createFileRoute("/dashboard")({
	component: DashboardPage,
});
