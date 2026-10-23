import { useRouter } from "@tanstack/react-router";
import type { ComponentProps, FocusEvent, MouseEvent } from "react";

// A link to an app path given as a plain string ("/dashboard/settings/billing?upgrade=pro"). It navigates in the
// app like the router's <Link> (and preloads the page on hover or focus), but takes any path, so shared components
// (breadcrumbs, menus, the palette, the sidebar) don't need the route types. A modified click (new tab) or a
// target keeps the browser's behaviour.
export function AppLink({
	href,
	onClick,
	onMouseEnter,
	onFocus,
	target,
	...props
}: ComponentProps<"a"> & { href: string }) {
	const router = useRouter();
	const internal = href.startsWith("/") && !target;
	const preload = () => {
		// The router builds the location from `href` (as navigate does); its types only describe `to`.
		if (internal) router.preloadRoute({ href } as unknown as Parameters<typeof router.preloadRoute>[0]).catch(() => {});
	};
	const follow = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || !internal || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		void router.navigate({ href });
	};
	return (
		<a
			href={href}
			target={target}
			onClick={follow}
			onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
				onMouseEnter?.(event);
				preload();
			}}
			onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
				onFocus?.(event);
				preload();
			}}
			{...props}
		/>
	);
}
