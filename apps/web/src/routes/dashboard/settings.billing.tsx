import { createFileRoute } from "@tanstack/react-router";
import { BillingPage } from "../../settings/billing-page.tsx";
import { validateBillingSearch } from "../../settings/settings-search.ts";

export const Route = createFileRoute("/dashboard/settings/billing")({
	validateSearch: validateBillingSearch,
	component: function BillingRoute() {
		const { checkout, upgrade } = Route.useSearch();
		return <BillingPage checkout={checkout === "success"} upgrade={upgrade} />;
	},
});
