import { SignUp } from "@clerk/react";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthAsideLink, AuthLayout } from "./auth-layout.tsx";

export function SignUpPage() {
	useDocumentTitle("Create your account · LucidHire");

	return (
		<AuthLayout
			eyebrow="Create your account"
			title={
				<>
					Post a job <span className="mk">free</span>. We read every CV.
				</>
			}
			lede="Free for 10 CVs a job, no card. Next you name your company, and then your dashboard is ready."
			points={["Every CV read, not skimmed", "Evidence beside every score", "Upgrade only when the pile grows"]}
			headerAside={<AuthAsideLink prompt="Already have an account?" to="/sign-in/$" label="Sign in" />}
		>
			<SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
		</AuthLayout>
	);
}
