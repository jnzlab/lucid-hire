import { createFileRoute } from "@tanstack/react-router";
import { TeamPage } from "../../settings/team-page.tsx";

export const Route = createFileRoute("/dashboard/settings/team")({
	component: TeamPage,
});
