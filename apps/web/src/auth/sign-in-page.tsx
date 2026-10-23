import { SignIn } from "@clerk/react";
import { authFormAppearance } from "../lib/clerk-appearance.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthAsideLink, AuthLayout, ClerkFormStates } from "./auth-layout.tsx";
import { ShortlistStage } from "./stages.tsx";

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
			lede="Applications that came in while you were away are already read, scored and in order."
			headerAside={<AuthAsideLink prompt="New to LucidHire?" to="/sign-up/$" label="Create an account" />}
			stage={<ShortlistStage />}
		>
			<ClerkFormStates fields={1} />
			<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" appearance={authFormAppearance} />
		</AuthLayout>
	);
}
