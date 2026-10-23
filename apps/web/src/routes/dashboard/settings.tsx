import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "../../settings/settings-layout.tsx";

// Settings: the h1 and a tab bar of sub-pages (Company, Plan & billing, Team, Account) around the chosen one.
export const Route = createFileRoute("/dashboard/settings")({
	component: SettingsLayout,
});
