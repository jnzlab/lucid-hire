import { UserButton, useAuth } from "@clerk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, getRouteApi } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { AuthLayout, SignUpSteps } from "../auth/auth-layout.tsx";
import { RequireSession } from "../auth/require-session.tsx";
import { CompanyStage } from "../auth/stages.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { apiPost } from "../lib/api.ts";
import { type Me, type Org, meQueryKey, useMe } from "../lib/me.ts";
import { takePickedPlan } from "../lib/picked-plan.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";

// The same bounds and clean-up the API applies (apps/api/src/orgs.ts).
const NAME_MIN = 2;
const NAME_MAX = 80;
const NAME_HINT = `Enter a company name between ${NAME_MIN} and ${NAME_MAX} characters`;

export function OnboardingPage() {
	useDocumentTitle("Name your company · LucidHire");

	return (
		<RequireSession>
			<Onboarding />
		</RequireSession>
	);
}

const route = getRouteApi("/onboarding");

// Recruiters who already have a company skip straight to the page they came for, or the dashboard.
function Onboarding() {
	const me = useMe();
	const { next } = route.useSearch();
	// The stage shows the name on a sample job page as it is typed.
	const [name, setName] = useState("");
	if (me.isPending) return <PageLoading label="Loading your account" />;
	if (me.isError) return <PageError message={me.error.message} onRetry={() => void me.refetch()} />;
	if (me.data.org) return <PickedPlanRedirect next={next} />;

	return (
		<AuthLayout
			eyebrow={<SignUpSteps current={2} />}
			title={
				<>
					Name your <span className="mk">company</span>.
				</>
			}
			lede="It goes on your dashboard and on every job you post."
			headerAside={<UserButton />}
			stage={<CompanyStage name={name} />}
		>
			<CompanyForm name={name} onNameChange={setName} />
		</AuthLayout>
	);
}

// Onboarding is done. A deep link the recruiter was sent here from wins; otherwise someone who picked a paid plan on
// the pricing section lands on the plan cards with theirs highlighted (they pay only if they press Upgrade), and
// everyone else goes to the jobs.
function PickedPlanRedirect({ next }: { next: string | undefined }) {
	// Read once: React may render this twice before the redirect, and the plan is forgotten when read.
	const [plan] = useState(takePickedPlan);
	if (next) return <Navigate to={next} replace />;
	return plan ? (
		<Navigate to="/dashboard/settings/$" search={{ upgrade: plan }} replace />
	) : (
		<Navigate to="/dashboard" replace />
	);
}

function CompanyForm({ name, onNameChange }: { name: string; onNameChange: (name: string) => void }) {
	const { getToken, userId } = useAuth();
	const queryClient = useQueryClient();
	const [submitted, setSubmitted] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);

	// Saving the company into the cached account re-renders Onboarding, which sends them on.
	const create = useMutation({
		mutationFn: async (orgName: string) =>
			apiPost<{ org: Org }>("/orgs", { name: orgName }, { token: await getToken() }),
		onSuccess: ({ org }) => queryClient.setQueryData<Me>(meQueryKey(userId), (me) => me && { ...me, org }),
	});

	const cleaned = name.trim().replace(/\s+/g, " ");
	const invalid = cleaned.length < NAME_MIN || cleaned.length > NAME_MAX;
	const showInvalid = submitted && invalid;

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		// The button only looks disabled while saving (aria-disabled), so a click can still submit.
		if (create.isPending) return;
		setSubmitted(true);
		// Focus goes to the field, so its message is read out and fixing it is one keystroke away.
		if (invalid) nameRef.current?.focus();
		else create.mutate(cleaned);
	};

	return (
		<form
			onSubmit={onSubmit}
			noValidate
			aria-labelledby="company-h"
			className="w-full max-w-[400px]"
		>
			<h2 id="company-h" className="font-display text-[28px] leading-[1.1] font-[800] tracking-[-0.03em] [font-stretch:112%]">
				Company details
			</h2>
			<label htmlFor="company-name" className="mt-5 block text-[14px] font-semibold text-ink">
				Company name
			</label>
			<input
				ref={nameRef}
				id="company-name"
				name="organization"
				className="field mt-2"
				autoComplete="organization"
				placeholder="Acme Hiring"
				maxLength={NAME_MAX}
				value={name}
				onChange={(event) => onNameChange(event.target.value)}
				aria-invalid={showInvalid}
				aria-describedby={showInvalid ? "company-name-error" : "company-name-help"}
			/>
			{showInvalid ? (
				<p id="company-name-error" role="alert" className="mt-2 text-[13px] text-gap-ink">
					✕ {NAME_HINT}
				</p>
			) : (
				<p id="company-name-help" className="mt-2 text-[13px] text-ink-muted">
					{NAME_MIN} to {NAME_MAX} characters.
				</p>
			)}
			{create.isError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {create.error.message}
				</p>
			)}
			<button type="submit" className="btn mt-6 w-full" aria-disabled={create.isPending}>
				{create.isPending ? (
					"Setting up your dashboard"
				) : (
					<>
						Continue to your dashboard <ArrowRight />
					</>
				)}
			</button>
		</form>
	);
}
