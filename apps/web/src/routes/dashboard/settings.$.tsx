import { createFileRoute, redirect } from "@tanstack/react-router";

// Clerk's profile pages used to sit right under /dashboard/settings (/dashboard/settings/security and so on). Any
// sub-path that isn't a settings page of its own now belongs to the account page. Billing, Team and Account are
// static routes, so they always win over this splat.
export const Route = createFileRoute("/dashboard/settings/$")({
	beforeLoad: ({ params, location }) => {
		throw redirect({
			to: "/dashboard/settings/account/$",
			params: { _splat: params._splat ?? "" },
			hash: location.hash || undefined,
			replace: true,
		});
	},
});
