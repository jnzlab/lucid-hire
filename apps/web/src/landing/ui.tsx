import { SignInButton, SignUpButton } from "@clerk/react";
import type { ReactNode } from "react";

// Until the Auth PR adds sign-up and sign-in pages, every "start" CTA opens Clerk's sign-up modal.
export function SignUpCta({ className, children }: { className: string; children: ReactNode }) {
	return (
		<SignUpButton mode="modal">
			<button type="button" className={className}>
				{children}
			</button>
		</SignUpButton>
	);
}

export function SignInLink() {
	return (
		<SignInButton mode="modal">
			<button type="button">Sign in</button>
		</SignInButton>
	);
}

// The hand-drawn ink ring (design system §3) around a score, and the smaller one around step numbers.
export const RING_PATH = "M118 14C92 2 40 4 18 30 2 50 6 92 40 112c34 18 92 10 110-22 14-28 0-64-38-78-12-4-24-4-34-2";
export const STEP_RING_PATH = "M47 6C30-1 8 8 5 30c-3 20 14 33 31 31 18-2 28-17 25-33C58 14 47 7 33 7";

export function ArrowRight() {
	return (
		<svg className="arr" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M3 9h11M10 4.5 14.5 9 10 13.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

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
