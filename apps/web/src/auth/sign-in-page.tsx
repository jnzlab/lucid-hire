import { SignIn } from "@clerk/react";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthAsideLink, AuthLayout } from "./auth-layout.tsx";

export function SignInPage() {
	useDocumentTitle("Sign in · LucidHire");

	return (
		<AuthLayout
			eyebrow="Sign in"
			title={
				<>
					Welcome back. Your <span className="mk">shortlist</span> is waiting.
				</>
			}
			lede="Every CV you upload is read in full and scored against your requirements, with the evidence beside each score."
			points={["Every CV read, not skimmed", "Evidence beside every score", "Free for 10 CVs a job"]}
			headerAside={<AuthAsideLink prompt="New to LucidHire?" to="/sign-up/$" label="Create an account" />}
		>
			<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
		</AuthLayout>
	);
}
