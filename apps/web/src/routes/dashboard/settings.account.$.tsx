import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "../../settings/account-page.tsx";

// A splat route, so Clerk's own sub-pages (security and the rest) fit under /dashboard/settings/account/….
export const Route = createFileRoute("/dashboard/settings/account/$")({
	component: AccountPage,
});
