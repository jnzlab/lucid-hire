import { useAuth } from "@clerk/react";
import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PageError } from "./page-state.tsx";

// The router's defaults (see router.ts): an address that matches no page, and a page that crashed.
export function RouteNotFound() {
	useDocumentTitle("Page not found · LucidHire");
	const { isSignedIn } = useAuth();

	return (
		<PageError
			compact
			title="This page doesn't exist"
			message="The link may be old, or the address may have a typo."
			action={
				isSignedIn ? (
					<Link to="/dashboard" className="btn">
						Back to your jobs
					</Link>
				) : (
					<Link to="/" className="btn">
						Back to home
					</Link>
				)
			}
		/>
	);
}

// What went wrong stays in the console; the recruiter gets a plain line and a way to try again.
export function RouteError({ reset }: ErrorComponentProps) {
	useDocumentTitle("Something went wrong · LucidHire");

	return <PageError compact title="Something went wrong" message="This page hit a problem. Try again." onRetry={reset} />;
}
