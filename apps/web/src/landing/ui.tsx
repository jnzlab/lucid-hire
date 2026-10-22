import { useAuth } from "@clerk/react";
import { type PlanKey, isPaidPlanKey } from "@lucid-hire/plans";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Every "start" CTA leads to sign-up, or straight to the dashboard for someone already signed in. A pricing CTA also
// carries the plan it stands for: through sign-up and onboarding, or straight to the settings page when signed in.
export function SignUpCta({ className, children, plan }: { className: string; children: ReactNode; plan?: PlanKey }) {
	const { isSignedIn } = useAuth();
	const paid = isPaidPlanKey(plan) ? plan : undefined;
	if (isSignedIn && paid) {
		return (
			<Link to="/dashboard/settings/$" search={{ upgrade: paid }} className={className}>
				{children}
			</Link>
		);
	}
	return (
		<Link
			to={isSignedIn ? "/dashboard" : "/sign-up/$"}
			search={!isSignedIn && paid ? { plan: paid } : undefined}
			className={className}
		>
			{children}
		</Link>
	);
}

export function SignInLink() {
	return <Link to="/sign-in/$">Sign in</Link>;
}

// The hand-drawn ink ring (design system §3) around a score, and the smaller one around step numbers.
export const RING_PATH = "M118 14C92 2 40 4 18 30 2 50 6 92 40 112c34 18 92 10 110-22 14-28 0-64-38-78-12-4-24-4-34-2";
export const STEP_RING_PATH = "M47 6C30-1 8 8 5 30c-3 20 14 33 31 31 18-2 28-17 25-33C58 14 47 7 33 7";

export function ArrowDown() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M8 2.5v10M3.5 8.5 8 13l4.5-4.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function Tick() {
	return (
		<svg className="tick" viewBox="0 0 14 14" aria-hidden="true">
			<path d="M2 7.5 5.5 11 12 3.5" fill="none" stroke="#141414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function PlanCheck() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.5 8.5 6 12l7.5-8" fill="none" stroke="#141414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function ClaimCheck() {
	return (
		<svg viewBox="0 0 26 26" aria-hidden="true">
			<rect x="1" y="1" width="24" height="24" rx="5" fill="#FFE84A" />
			<path d="M6.5 13.5l4.5 4.5 8.5-10" fill="none" stroke="#141414" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}
