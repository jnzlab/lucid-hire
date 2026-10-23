import { useAuth, useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthLayout } from "./auth-layout.tsx";
import { ShortlistStage } from "./stages.tsx";

type Status = "checking" | "working" | "done" | "already" | "failed";

// Signs the visitor out as soon as the page opens, and says what happened. Clerk is given an empty callback so it
// stays here instead of redirecting to the home page.
export function SignOutPage() {
	useDocumentTitle("Sign out · LucidHire");
	const { isLoaded, isSignedIn } = useAuth();
	const { signOut } = useClerk();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<Status>("checking");
	const [problem, setProblem] = useState("");
	const started = useRef(false);

	const run = async () => {
		setStatus("working");
		try {
			await signOut(() => {});
			// What the last session loaded must not show to the next person at this screen.
			queryClient.clear();
			setStatus("done");
		} catch (error) {
			console.error("Sign out failed", error);
			setProblem(error instanceof Error && error.message ? error.message : "Something went wrong.");
			setStatus("failed");
		}
	};

	// Once Clerk has loaded: sign out if there is a session, otherwise say there was none. Once only, so a
	// re-render after the session ends does not turn "signed out" into "already signed out".
	useEffect(() => {
		if (!isLoaded || started.current) return;
		started.current = true;
		if (isSignedIn) void run();
		else setStatus("already");
	});

	return (
		<AuthLayout
			eyebrow="Sign out"
			title={
				<>
					{status === "already" ? "You're already " : "You're "}
					<span className="mk">signed out</span>.
				</>
			}
			lede="Your jobs and shortlists are saved, and they are here when you sign in again."
			stage={<ShortlistStage live={false} />}
		>
			<section
				aria-labelledby="signout-h"
				className="w-full max-w-[400px]"
			>
				<h2 id="signout-h" className="font-display text-[28px] leading-[1.1] font-[800] tracking-[-0.03em] [font-stretch:112%]">
					{status === "failed" ? "We couldn't sign you out" : "Sign out"}
				</h2>
				<div role="status" aria-live="polite" className="mt-4 text-[15px] text-ink-2">
					{(status === "checking" || status === "working") && <p>Signing you out</p>}
					{status === "done" && <p>You're signed out.</p>}
					{status === "already" && <p>You're already signed out. There was no session on this device.</p>}
				</div>
				{status === "failed" && (
					<p role="alert" className="mt-4 text-[14px] text-gap-ink">
						✕ {problem}
					</p>
				)}
				<div className="mt-6 flex flex-wrap gap-3">
					{status === "failed" ? (
						<button type="button" className="btn" onClick={() => void run()}>
							Try again
						</button>
					) : (
						<Link to="/sign-in/$" className="btn">
							Sign in again
						</Link>
					)}
					<Link to="/" className="btn ghost">
						Go home
					</Link>
				</div>
			</section>
		</AuthLayout>
	);
}
