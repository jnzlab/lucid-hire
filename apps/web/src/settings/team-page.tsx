import { ChevronDown, Copy, Link2 } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Avatar } from "../dashboard/avatar.tsx";
import { useOrg } from "../dashboard/org.ts";
import { formatDate } from "../lib/format.ts";
import {
	type PendingInvite,
	ROLE_LABEL,
	type Role,
	type TeamMember,
	displayName,
	useChangeRole,
	useCreateInvite,
	useInvites,
	useRevokeInvite,
	useTeam,
} from "../lib/team.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { CountBadge } from "../ui/count-badge.tsx";
import { Menu, MenuItem } from "../ui/menu.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useToast } from "../ui/use-toast.ts";
import { CardError, SettingsCard } from "./settings-ui.tsx";

const ROLE_DESCRIPTION: Record<Role, string> = {
	admin: "The plan, the team and deleting jobs and candidates",
	member: "Posts jobs and reviews candidates",
};

// Settings → Team: who's in the company and their roles (admins change them), and for admins the invite links.
export function TeamPage() {
	useDocumentTitle("Team · LucidHire");
	const org = useOrg();
	const isAdmin = org.role === "admin";
	return (
		<div className="grid gap-6">
			<Members isAdmin={isAdmin} />
			{isAdmin && <Invites />}
		</div>
	);
}

function Members({ isAdmin }: { isAdmin: boolean }) {
	const team = useTeam();
	const changeRole = useChangeRole();
	const toast = useToast();
	// Making yourself a member takes away this page's controls, so it asks first.
	const [demoting, setDemoting] = useState<TeamMember | null>(null);

	const apply = (member: TeamMember, role: Role) =>
		changeRole.mutate(
			{ memberId: member.userId, role },
			{
				onSuccess: () =>
					toast.show(
						member.isYou
							? `You're now ${role === "admin" ? "an admin" : "a member"}`
							: `${displayName(member)} is now ${role === "admin" ? "an admin" : "a member"}`,
					),
			},
		);
	const choose = (member: TeamMember, role: Role) => {
		if (role === member.role || changeRole.isPending) return;
		if (member.isYou && role === "member") setDemoting(member);
		else apply(member, role);
	};

	const count = team.data?.length;
	return (
		<SettingsCard
			title={
				<span className="inline-flex items-center gap-2.5">
					Members {count !== undefined && <CountBadge count={count} />}
				</span>
			}
			description={
				isAdmin
					? "Admins look after the plan, the team and deleting jobs and candidates. Members post jobs and review candidates."
					: "Only admins can invite people or change roles."
			}
		>
			{team.isPending ? (
				<div role="status" className="grid gap-4">
					<span className="sr-only">Loading your team</span>
					{[0, 1, 2].map((row) => (
						<div key={row} className="flex items-center gap-4" aria-hidden="true">
							<span className="skeleton size-10 flex-none !rounded-full" />
							<Skeleton lines={2} className="h-3.5 w-48 max-w-full" />
						</div>
					))}
				</div>
			) : team.isError ? (
				<CardError message={team.error.message} onRetry={() => void team.refetch()} />
			) : (
				<ul aria-label="Team members" className="-my-3">
					{team.data.map((member) => (
						<MemberRow
							key={member.userId}
							member={member}
							isAdmin={isAdmin}
							busy={changeRole.isPending && changeRole.variables?.memberId === member.userId}
							onRole={(role) => choose(member, role)}
						/>
					))}
				</ul>
			)}
			{changeRole.isError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {changeRole.error.message}
				</p>
			)}
			{demoting && (
				<ConfirmDialog
					heading="Make yourself a member?"
					confirmLabel="Make me a member"
					onCancel={() => setDemoting(null)}
					onConfirm={() => {
						apply(demoting, "member");
						setDemoting(null);
					}}
				>
					You'll no longer be able to change the plan, the team or roles, or delete jobs and candidates. Another admin
					can make you an admin again.
				</ConfirmDialog>
			)}
		</SettingsCard>
	);
}

// A person: photo or initials, name (or email, or "Unnamed member") with a You tag, email and when they joined, then
// their role, as a menu for admins and as a tag for everyone else.
function MemberRow({
	member,
	isAdmin,
	busy,
	onRole,
}: {
	member: TeamMember;
	isAdmin: boolean;
	busy: boolean;
	onRole: (role: Role) => void;
}) {
	const name = displayName(member);
	return (
		<li className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line-2 py-3 last:border-b-0 @min-[561px]:gap-x-4">
			<Avatar account={member} size={40} />
			<div className="min-w-0">
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] leading-[1.3] font-[700] [overflow-wrap:anywhere]">
					{name}
					{member.isYou && (
						<span className="rounded-md border border-line px-2 py-0.5 font-mono text-[12px] leading-none font-normal text-ink-muted">
							You
						</span>
					)}
				</p>
				<p className="mt-0.5 font-mono text-[12.5px] leading-[1.4] text-ink-muted [overflow-wrap:anywhere]">
					{member.name && member.email ? `${member.email} · ` : ""}Joined {formatDate(member.joinedAt)}
				</p>
			</div>
			{isAdmin ? (
				<Menu
					align="end"
					trigger={(props) => (
						<button {...props} className="btn ghost xs min-h-11 gap-1.5 !px-3" aria-busy={busy}>
							{busy && <span className="live-dot" aria-hidden="true" />}
							<span>
								<span className="sr-only">Role for {name}:</span> {ROLE_LABEL[member.role]}
							</span>
							<ChevronDown size={16} aria-hidden="true" />
						</button>
					)}
				>
					{(["admin", "member"] as const).map((role) => (
						<MenuItem key={role} checked={member.role === role} description={ROLE_DESCRIPTION[role]} onSelect={() => onRole(role)}>
							{ROLE_LABEL[role]}
						</MenuItem>
					))}
				</Menu>
			) : (
				<span className="inline-flex min-h-7 items-center rounded-md border border-line bg-sheet px-2.5 font-mono text-[12.5px] leading-none">
					{ROLE_LABEL[member.role]}
				</span>
			)}
		</li>
	);
}

// Invite links (admins only; the list is only fetched for them). A link works once and expires in 7 days; revoking
// one asks first, because whoever was sent it can't join with it any more.
function Invites() {
	const create = useCreateInvite();
	const invites = useInvites(true);
	const revoke = useRevokeInvite();
	const toast = useToast();
	const linkRef = useRef<HTMLInputElement>(null);
	const createRef = useRef<HTMLButtonElement>(null);
	const [revoking, setRevoking] = useState<PendingInvite | null>(null);
	const created = create.data;

	const copy = async () => {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created.url);
			toast.show("Invite link copied");
		} catch {
			// Focus and select it, so copying by hand is one shortcut away (select() alone doesn't always focus).
			linkRef.current?.focus();
			linkRef.current?.select();
			toast.error(
				<>
					Couldn't <span className="mk mk-gap">copy</span>. Select the link and copy it.
				</>,
			);
		}
	};

	const confirmRevoke = () => {
		if (!revoking || revoke.isPending) return;
		const id = revoking.id;
		revoke.mutate(id, {
			onSuccess: () => {
				setRevoking(null);
				toast.show("Invite revoked. Its link no longer works.");
				// A revoked link is dead, so the one just created stops being offered for copying.
				if (id === created?.id) create.reset();
				// Its row (and the Revoke button focus would go back to) is gone; continue from the create button.
				requestAnimationFrame(() => createRef.current?.focus());
			},
		});
	};

	const pending = invites.data ?? [];
	return (
		<SettingsCard
			title="Invite a teammate"
			description="Create a link and send it to them. They sign in, open it and join as a member. It works once and expires in 7 days."
			actions={
				<button
					ref={createRef}
					type="button"
					// Once a link exists, copying it is the next step, so Copy link becomes the primary button.
					className={created ? "btn ghost" : "btn"}
					aria-disabled={create.isPending}
					onClick={() => {
						if (!create.isPending) create.mutate();
					}}
				>
					<Link2 size={18} aria-hidden="true" />
					{create.isPending ? "Creating the link" : created ? "Create another link" : "Create invite link"}
				</button>
			}
		>
			{create.isError && (
				<p role="alert" className="mb-4 text-[14px] text-gap-ink">
					✕ {create.error.message}
				</p>
			)}
			{created && (
				<div className="mb-6 rounded-lg bg-paper p-4 shadow-[0_1px_0_var(--line)]">
					<label htmlFor="invite-link" className="block text-[14px] font-semibold">
						Invite link
					</label>
					<div className="mt-2 flex flex-wrap items-center gap-3">
						<input
							ref={linkRef}
							id="invite-link"
							readOnly
							className="field min-w-0 flex-[1_1_260px] font-mono !text-[14px]"
							value={created.url}
							onFocus={(event) => event.currentTarget.select()}
							aria-describedby="invite-expiry"
						/>
						<button type="button" className="btn" onClick={() => void copy()}>
							<Copy size={18} aria-hidden="true" />
							Copy link
						</button>
					</div>
					<p id="invite-expiry" className="mt-2 font-mono text-[12.5px] text-ink-muted">
						Works once · expires {formatDate(created.expiresAt)}
					</p>
				</div>
			)}

			<h3 className="flex items-center gap-2 text-[15px] font-[650]">
				Pending invites {pending.length > 0 && <CountBadge count={pending.length} />}
			</h3>
			{invites.isPending ? (
				<Skeleton className="mt-3 h-4 w-64 max-w-full" label="Loading pending invites" />
			) : invites.isError ? (
				<div className="mt-3">
					<CardError message={invites.error.message} onRetry={() => void invites.refetch()} />
				</div>
			) : pending.length === 0 ? (
				<p className="mt-1.5 text-[14px] text-ink-muted">No pending invites. Links you create show here until someone uses them or they expire.</p>
			) : (
				<ul aria-label="Pending invites" className="mt-2">
					{pending.map((invite) => (
						<li key={invite.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-2 py-2.5 last:border-b-0">
							<p className="font-mono text-[12.5px] leading-[1.4] text-ink-muted">
								Link created {formatDate(invite.createdAt)} · expires {formatDate(invite.expiresAt)}
								{invite.id === created?.id && <span className="ml-2 text-ink">· Just created</span>}
							</p>
							<button
								type="button"
								className="btn danger xs min-h-11"
								aria-label={`Revoke the invite created ${formatDate(invite.createdAt)}`}
								onClick={() => {
									revoke.reset();
									setRevoking(invite);
								}}
							>
								Revoke
							</button>
						</li>
					))}
				</ul>
			)}
			{revoking && (
				<ConfirmDialog
					heading="Revoke this invite?"
					confirmLabel="Revoke invite"
					busyLabel="Revoking"
					busy={revoke.isPending}
					error={revoke.error?.message ?? null}
					onCancel={() => setRevoking(null)}
					onConfirm={confirmRevoke}
				>
					The link created {formatDate(revoking.createdAt)} stops working. Anyone you sent it to who hasn't joined yet
					will need a new link.
				</ConfirmDialog>
			)}
		</SettingsCard>
	);
}
