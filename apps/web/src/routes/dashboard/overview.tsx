import { createFileRoute, redirect } from "@tanstack/react-router";

// The overview used to live here; old links and bookmarks land on its new address.
export const Route = createFileRoute("/dashboard/overview")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard", replace: true });
	},
});
