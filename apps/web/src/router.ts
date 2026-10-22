import { type RouterHistory, createRouter } from "@tanstack/react-router";
import { RouteError, RouteNotFound } from "./components/route-states.tsx";
import { routeTree } from "./routeTree.gen.ts";

// The app's router. Tests pass a memory history.
export function createAppRouter(history?: RouterHistory) {
	return createRouter({
		routeTree,
		history,
		defaultPreload: "intent",
		defaultNotFoundComponent: RouteNotFound,
		defaultErrorComponent: RouteError,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAppRouter>;
	}
}
