import { createRootRoute, Outlet } from "@tanstack/react-router";

// Each area brings its own chrome: the landing page its header and footer, the sign-in, sign-up
// and onboarding pages their AuthLayout, and the signed-in pages the AppShell.
export const Route = createRootRoute({
	component: Outlet,
});
