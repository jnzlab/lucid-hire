import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "../../dashboard/dashboard-layout.tsx";

export const Route = createFileRoute("/dashboard")({
	component: DashboardLayout,
});
