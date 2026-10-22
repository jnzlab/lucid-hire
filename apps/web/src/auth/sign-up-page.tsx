import { SignUp } from "@clerk/react";
import { isPaidPlanKey } from "@lucid-hire/plans";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { rememberPickedPlan } from "../lib/picked-plan.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthAsideLink, AuthLayout } from "./auth-layout.tsx";

export function SignUpPage() {
	useDocumentTitle("Create your account · LucidHire");

	// /sign-up?plan=pro comes from a pricing button. Keep the plan through sign-up and onboarding.
	const search = useRouterState({ select: (state) => state.location.searchStr });
	useEffect(() => {
		const plan = new URLSearchParams(search).get("plan");
		if (isPaidPlanKey(plan)) rememberPickedPlan(plan);
	}, [search]);

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
