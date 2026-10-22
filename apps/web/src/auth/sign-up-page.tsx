import { SignUp } from "@clerk/react";
import { PLANS, type PaidPlanKey, isPaidPlanKey, priceLabel } from "@lucid-hire/plans";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authFormAppearance } from "../lib/clerk-appearance.ts";
import { peekPickedPlan, rememberPickedPlan } from "../lib/picked-plan.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AuthAsideLink, AuthLayout, ClerkFormStates, SignUpSteps } from "./auth-layout.tsx";
import { ReadingStage } from "./stages.tsx";

export function SignUpPage() {
	useDocumentTitle("Create your account · LucidHire");

	// /sign-up?plan=pro comes from a pricing button. Keep the plan through sign-up and onboarding, and say so here,
	// including on Clerk's later steps, whose addresses drop the query.
	const search = useRouterState({ select: (state) => state.location.searchStr });
	const [plan, setPlan] = useState<PaidPlanKey | undefined>(peekPickedPlan);
	useEffect(() => {
		const picked = new URLSearchParams(search).get("plan");
		if (isPaidPlanKey(picked)) {
			rememberPickedPlan(picked);
			setPlan(picked);
		}
	}, [search]);

	return (
		<AuthLayout
			eyebrow={<SignUpSteps current={1} />}
			title={
				<>
					Post a job <span className="mk">free</span>. We read every CV.
				</>
			}
			lede="Free for 10 CVs a job, no card. Next you name your company, then you post your first job."
			note={plan && <PickedPlanNote plan={plan} />}
			headerAside={<AuthAsideLink prompt="Already have an account?" to="/sign-in/$" label="Sign in" />}
			stage={<ReadingStage />}
		>
			<ClerkFormStates fields={4} />
			<SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={authFormAppearance} />
		</AuthLayout>
	);
}

function PickedPlanNote({ plan }: { plan: PaidPlanKey }) {
	const config = PLANS[plan];
	return (
		<p className="w-fit max-w-full rounded-md border-[1.5px] border-ink bg-sheet px-3 py-2 font-mono text-[12.5px] leading-[1.35] text-ink">
			You picked <span className="mk">{config.name}</span> · {priceLabel(config)} a month, paid only when you upgrade
		</p>
	);
}
