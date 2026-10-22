import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { clerkAppearance, clerkLocalization } from "./lib/clerk-appearance.ts";
import { CLERK_PUBLISHABLE_KEY } from "./lib/config.ts";
import { routeTree } from "./routeTree.gen.ts";

const queryClient = new QueryClient();
const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ClerkProvider
			publishableKey={CLERK_PUBLISHABLE_KEY}
			appearance={clerkAppearance}
			localization={clerkLocalization}
			signInUrl="/sign-in"
			signUpUrl="/sign-up"
			signInFallbackRedirectUrl="/dashboard"
			signUpFallbackRedirectUrl="/onboarding"
			afterSignOutUrl="/"
			routerPush={(to) => router.navigate({ href: to })}
			routerReplace={(to) => router.navigate({ href: to, replace: true })}
		>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ClerkProvider>
	</StrictMode>,
);
