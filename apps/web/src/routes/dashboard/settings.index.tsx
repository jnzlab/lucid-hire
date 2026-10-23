import { createFileRoute, redirect } from "@tanstack/react-router";
import { CompanyPage } from "../../settings/company-page.tsx";
import { ANCHOR_PAGES, validateBillingSearch } from "../../settings/settings-search.ts";

// Company is the first settings page. The plan used to live here too, so Polar's return (`?checkout=success`), a plan
// picked on the pricing section (`?upgrade=pro`) and the old #plan, #team and #account anchors move on to the
// sub-page that has them now, replacing this entry so Back doesn't bounce.
export const Route = createFileRoute("/dashboard/settings/")({
	validateSearch: validateBillingSearch,
	beforeLoad: ({ search, location }) => {
		if (search.checkout || search.upgrade) {
			throw redirect({ to: "/dashboard/settings/billing", search, replace: true });
		}
		const page = ANCHOR_PAGES[location.hash];
		if (page) throw redirect({ href: page, replace: true });
	},
	component: CompanyPage,
});
