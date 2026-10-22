import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../settings/settings-page.tsx";

// `checkout=success` is where Polar sends people after paying; `upgrade` is the plan they picked before signing up.
export const Route = createFileRoute("/dashboard/settings/$")({
	validateSearch: (search: Record<string, unknown>): { checkout?: "success"; upgrade?: "pro" | "max" } => ({
		checkout: search.checkout === "success" ? "success" : undefined,
		upgrade: search.upgrade === "pro" || search.upgrade === "max" ? search.upgrade : undefined,
	}),
	component: function SettingsRoute() {
		const { checkout, upgrade } = Route.useSearch();
		return <SettingsPage checkout={checkout === "success"} upgrade={upgrade} />;
	},
});
