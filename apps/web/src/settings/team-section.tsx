import { type ChangeEvent, useState } from "react";
import { formatDate } from "../lib/format.ts";
import {
	type PendingInvite,
	ROLE_LABEL,
	type Role,
	type TeamMember,
	displayName,
	initials,
	useChangeRole,
	useCreateInvite,
	useInvites,
	useRevokeInvite,
	useTeam,
} from "../lib/team.ts";

function Avatar({ member }: { member: TeamMember }) {
	return member.imageUrl ? (
		<img src={member.imageUrl} alt="" className="size-10 flex-none rounded-full object-cover" />
	) : (
		<span
			aria-hidden="true"
			className="grid size-10 flex-none place-items-center rounded-full bg-paper-2 font-mono text-[13px] text-ink"
		>
			{initials(member)}
		</span>
	);
}

function MemberRow({
	member,
	isAdmin,
	onRole,
	busy,
}: {
	member: TeamMember;
	isAdmin: boolean;
	onRole: (member: TeamMember, role: Role) => void;
	busy: boolean;
}) {
	const name = displayName(member);
	const selectId = `role-${member.userId}`;
	return (
		<li className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-2 py-3 last:border-b-0">
			<Avatar member={member} />
			<div className="min-w-0 flex-1 basis-48">
				<p className="flex flex-wrap items-center gap-2 text-[16px] font-[700] [overflow-wrap:anywhere]">
					{name}
					{member.isYou && (
						<span className="rounded-md border border-line px-2 font-mono text-[12px] font-normal text-ink-muted">You</span>
					)}
				</p>
				<p className="font-mono text-[12.5px] text-ink-muted [overflow-wrap:anywhere]">
					{member.name && member.email ? `${member.email} · ` : ""}Joined {formatDate(member.joinedAt)}
				</p>
			</div>
			{isAdmin ? (
				<div>
					<label htmlFor={selectId} className="sr-only">
						Role for {name}
					</label>
					<select
						id={selectId}
						className="field !min-h-11 !w-auto"
						value={member.role}
						aria-busy={busy}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => onRole(member, event.target.value as Role)}
					>
						<option value="admin">{ROLE_LABEL.admin}</option>
						<option value="member">{ROLE_LABEL.member}</option>
					</select>
				</div>
			) : (
				<span className="inline-flex min-h-7 items-center rounded-md border border-line bg-sheet px-2.5 font-mono text-[12.5px]">
					{ROLE_LABEL[member.role]}
				</span>
			)}
		</li>
	);
}

function InviteBox() {
	const create = useCreateInvite();
	const invites = useInvites(true);
	const revoke = useRevokeInvite();
	const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
	const [revoked, setRevoked] = useState(false);
	const created = create.data;

	// A revoked link is dead, so the one just created stops being offered for copying when it is revoked.
	const revokeInvite = (id: string) =>
		revoke.mutate(id, {
			onSuccess: () => {
				setRevoked(true);
				if (id === created?.id) create.reset();
			},
		});

	const copy = async () => {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created.url);
			setCopied("copied");
		} catch {
			setCopied("failed");
		}
	};

	return (
		<div className="mt-6 rounded-lg bg-paper p-4 shadow-[0_1px_0_var(--line)]">
			<h3 className="text-[17px] font-[800] [font-stretch:108%]">Invite a teammate</h3>
			<p className="mt-1 text-[14px] text-ink-muted">
				Create a link and send it to them. They sign in, open it and join as a member. It works once and expires in 7 days.
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<button
					type="button"
					className="btn ghost"
					aria-disabled={create.isPending}
					onClick={() => {
						if (create.isPending) return;
						setCopied(null);
						setRevoked(false);
						create.mutate();
					}}
				>
					{create.isPending ? "Creating the link" : created ? "Create another link" : "Create invite link"}
				</button>
			</div>
			{create.isError && (
				<p role="alert" className="mt-3 text-[14px] text-gap-ink">
					✕ {create.error.message}
				</p>
			)}
			{created && (
				<div className="mt-4">
					<label htmlFor="invite-link" className="block text-[14px] font-semibold">
						Invite link
					</label>
					<div className="mt-2 flex flex-wrap items-center gap-3">
						<input id="invite-link" readOnly className="field min-w-0 flex-1 basis-64 font-mono !text-[14px]" value={created.url} onFocus={(event) => event.currentTarget.select()} />
						<button type="button" className="btn" onClick={() => void copy()}>
							Copy link
						</button>
					</div>
					<p role="status" className="mt-2 font-mono text-[12.5px] text-ink-muted">
						{copied === "copied"
							? "Copied. "
							: copied === "failed"
								? "Couldn't copy. Select the link and copy it. "
								: ""}
						Expires {formatDate(created.expiresAt)}.
					</p>
				</div>
			)}

			<p role="status" className={`font-mono text-[12.5px] text-ink-muted ${revoked ? "mt-3" : ""}`}>
				{revoked ? "Invite revoked. Its link no longer works." : ""}
			</p>

			{invites.data && invites.data.length > 0 && (
				<div className="mt-5">
					<h4 className="text-[14px] font-semibold">Pending invites</h4>
					<ul className="mt-1">
						{invites.data.map((invite) => (
							<PendingRow key={invite.id} invite={invite} busy={revoke.isPending && revoke.variables === invite.id} onRevoke={() => revokeInvite(invite.id)} />
						))}
					</ul>
					{revoke.isError && (
						<p role="alert" className="mt-2 text-[14px] text-gap-ink">
							✕ {revoke.error.message}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function PendingRow({ invite, busy, onRevoke }: { invite: PendingInvite; busy: boolean; onRevoke: () => void }) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 py-2 last:border-b-0">
			<p className="font-mono text-[12.5px] text-ink-muted">
				Link created {formatDate(invite.createdAt)} · expires {formatDate(invite.expiresAt)}
			</p>
			<button
				type="button"
				className="btn ghost danger"
				aria-disabled={busy}
				aria-label={`Revoke the invite created ${formatDate(invite.createdAt)}`}
				onClick={() => !busy && onRevoke()}
			>
				{busy ? "Revoking" : "Revoke"}
			</button>
		</li>
	);
}

export function TeamSection({ isAdmin }: { isAdmin: boolean }) {
	const team = useTeam();
	const changeRole = useChangeRole();

	return (
		<section id="team" aria-labelledby="team-h" className="rounded-xl bg-sheet p-6 shadow-card min-[561px]:p-8">
			<h2 id="team-h" className="text-[22px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
				Team
			</h2>
			{team.isPending ? (
				<p role="status" className="mt-5 inline-flex min-h-11 items-center gap-2.5 font-mono text-[13.5px] text-ink">
					<span className="live-dot" aria-hidden="true" />
					Loading your team
				</p>
			) : team.isError ? (
				<div role="alert" className="mt-5 flex flex-col items-start gap-3">
					<p className="text-[15px] text-gap-ink">✕ {team.error.message}</p>
					<button type="button" className="btn" onClick={() => void team.refetch()}>
						Try again
					</button>
				</div>
			) : (
				<ul aria-label="Team members" className="mt-4">
					{team.data.map((member) => (
						<MemberRow
							key={member.userId}
							member={member}
							isAdmin={isAdmin}
							busy={changeRole.isPending && changeRole.variables?.memberId === member.userId}
							onRole={(target, role) => {
								if (role !== target.role) changeRole.mutate({ memberId: target.userId, role });
							}}
						/>
					))}
				</ul>
			)}
			{changeRole.isError && (
				<p role="alert" className="mt-3 text-[14px] text-gap-ink">
					✕ {changeRole.error.message}
				</p>
			)}
			{isAdmin && <InviteBox />}
		</section>
	);
}
