import { Show, SignInButton, UserButton } from "@clerk/react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Logo } from "../components/logo.tsx";

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<>
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-sheet focus:px-4 focus:py-3"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-40 bg-paper/90 backdrop-blur-md backdrop-saturate-150">
				<div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-[clamp(16px,4vw,56px)] max-[900px]:h-[58px]">
					<Link to="/" aria-label="LucidHire home" className="rounded-sm no-underline">
						<Logo />
					</Link>
					<nav aria-label="Account" className="flex items-center gap-3">
						<Show when="signed-out">
							<SignInButton mode="modal">
								<button
									type="button"
									className="inline-flex h-[42px] min-w-11 items-center rounded-md border-2 border-ink bg-ink px-4 text-base font-[650] text-paper transition-colors duration-300 ease-out hover:bg-marker hover:text-ink"
								>
									Sign in
								</button>
							</SignInButton>
						</Show>
						<Show when="signed-in">
							<UserButton />
						</Show>
					</nav>
				</div>
			</header>
			<main id="main">
				<Outlet />
			</main>
		</>
	);
}
