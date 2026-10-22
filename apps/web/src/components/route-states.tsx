import { useAuth } from "@clerk/react";
import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PageError } from "./page-state.tsx";

// The router's defaults (see router.ts): an address that matches no page, and a page that crashed.
export function RouteNotFound() {
	useDocumentTitle("Page not found · LucidHire");
	const { isSignedIn } = useAuth();

	return (
		<PageError
			compact
			title="This page does not exist"
			message="The link may be old, or the address may have a typo."
			action={
				<div className="flex flex-wrap gap-3">
					<Link to="/" className={isSignedIn ? "btn ghost" : "btn"}>
						Go home
					</Link>
					{isSignedIn && (
						<Link to="/dashboard" className="btn">
							Open your dashboard
						</Link>
					)}
				</div>
			}
		/>
	);
}

export function newErrorReference() {
	return crypto.randomUUID().slice(0, 8);
}

// What went wrong stays in the console, next to a short reference that is also on the page, so a recruiter can
// quote it to support and we can find the error. The recruiter gets a plain line and a way to try again.
export function RouteError({ error, reset }: ErrorComponentProps) {
	useDocumentTitle("Something went wrong · LucidHire");
	// One reference per error, not per render.
	const reference = useMemo(newErrorReference, [error]);

	useEffect(() => {
		console.error(`Error reference ${reference}`, error);
	}, [reference, error]);

	return (
		<PageError
			compact
			title="Something went wrong"
			message="This page hit a problem. Try again."
			reference={reference}
			onRetry={reset}
		/>
	);
}
