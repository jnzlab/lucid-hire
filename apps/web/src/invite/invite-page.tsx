import { UserButton } from "@clerk/react";
import { Link, Navigate } from "@tanstack/react-router";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { RequireSession } from "../auth/require-session.tsx";
import { ArrowRight } from "../components/icons.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { ApiError } from "../lib/api.ts";
import { useMe } from "../lib/me.ts";
import { useAcceptInvite, useInvite } from "../lib/team.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";

// Where an invite link leads. Signed-out visitors sign in (or create an account) first and come back here.
export function InvitePage({ token }: { token: string }) {
	useDocumentTitle("Join your team · LucidHire");

	return (
		<RequireSession>
			<Invite token={token} />
		</RequireSession>
	);
}

function Invite({ token }: { token: string }) {
	const me = useMe();
	const invite = useInvite(token, Boolean(me.data && !me.data.org));
	const accept = useAcceptInvite(token);

	if (me.isPending) return <PageLoading label="Loading your account" />;
	if (me.isError) return <PageError message={me.error.message} onRetry={() => void me.refetch()} />;

	const toDashboard = (
		<Link to="/dashboard" className="btn">
			Go to your dashboard <ArrowRight />
		</Link>
	);
	// Joining puts the company into the cached account; the dashboard takes it from there.
	if (me.data.org && accept.isSuccess) return <Navigate to="/dashboard" replace />;
	if (me.data.org) {
		return (
			<PageError
				title="You already belong to a company"
				message={`You're part of ${me.data.org.name}. An account can only be in one company, so this invite can't be used.`}
				action={toDashboard}
			/>
		);
	}

	if (invite.isPending) return <PageLoading label="Checking your invite" />;
	if (invite.isError) {
		const gone = invite.error instanceof ApiError && invite.error.status === 404;
		return (
			<PageError
				title={gone ? "This invite link doesn't work" : "We couldn't check your invite"}
				message={invite.error.message}
				{...(gone ? { action: toDashboard } : { onRetry: () => void invite.refetch() })}
			/>
		);
	}

	const company = invite.data.company.name;
	return (
		<AuthLayout
			eyebrow="You're invited"
			title={
				<>
					Join <span className="mk">{company}</span>.
				</>
			}
			lede="You'll see the company's jobs and candidates, and can score CVs and make decisions as a member."
			headerAside={<UserButton />}
		>
			<div className="w-full max-w-[440px] rounded-xl bg-sheet p-6 shadow-card min-[561px]:p-8">
				<h2 className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">Join {company}</h2>
				<p className="mt-2 text-[15px] text-ink-2">Your account will become a member of {company}.</p>
				{accept.isError && (
					<p role="alert" className="mt-4 text-[14px] text-gap-ink">
						✕ {accept.error.message}
					</p>
				)}
				<button
					type="button"
					className="btn mt-6 w-full"
					aria-disabled={accept.isPending}
					onClick={() => !accept.isPending && accept.mutate()}
				>
					{accept.isPending ? (
						"Joining"
					) : (
						<>
							Join {company} <ArrowRight />
						</>
					)}
				</button>
			</div>
		</AuthLayout>
	);
}
