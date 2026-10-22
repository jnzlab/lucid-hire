import { createRootRoute, Outlet } from "@tanstack/react-router";

// Each area brings its own chrome: the landing page has its own header and footer, and the
// signed-in app shell arrives with the Auth PR.
export const Route = createRootRoute({
	component: Outlet,
});
