import { PLANS } from "@lucid-hire/plans";
import { ArrowRight } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";
import { Avatar } from "../dashboard/avatar.tsx";
import { useOrg } from "../dashboard/org.ts";
import { type Billing, useBilling } from "../lib/billing.ts";
import { formatNumber } from "../lib/format.ts";
import { ORG_NAME_HINT, ORG_NAME_MAX, ORG_NAME_MIN, cleanOrgName, useRenameOrg } from "../lib/org.ts";
import { ROLE_LABEL, type Role, useInvites, useTeam } from "../lib/team.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AppLink } from "../ui/app-link.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useToast } from "../ui/use-toast.ts";
import { renewalLine, statusBadge } from "./plan-status.ts";
import { CardError, SettingsCard, SettingsRow, StatusBadge } from "./settings-ui.tsx";

const ROLE_HELP: Record<Role, string> = {
	admin: "You can change the plan, rename the company, invite people, change roles and delete jobs and candidates.",
	member: "You can post jobs and review candidates. Admins look after the plan and the team, and delete jobs and candidates.",
};

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

// Settings → Company: the company's name (admins rename it in place), your role, the team at a glance and the plan
// at a glance, each with the way to the page that manages it.
export function CompanyPage() {
	useDocumentTitle("Settings · LucidHire");
	const org = useOrg();
	const isAdmin = org.role === "admin";
	const nameId = useId();

	return (
		<div className="grid gap-6">
			<SettingsCard title="Company" description="Candidates see this name on your apply pages and in the emails you send them.">
				<SettingsRow label="Company name" labelFor={isAdmin ? nameId : undefined}>
					{isAdmin ? (
						<RenameForm inputId={nameId} name={org.name} />
					) : (
						<>
							<p className="text-[17px] leading-[1.35] font-[650] [overflow-wrap:anywhere]">{org.name}</p>
							<p className="mt-1 text-[14px] text-ink-muted">Only admins can rename the company.</p>
						</>
					)}
				</SettingsRow>
				<SettingsRow label="Your role">
					<p className="text-[17px] leading-[1.35] font-[650]">{ROLE_LABEL[org.role]}</p>
					<p className="mt-1 max-w-[60ch] text-[14px] leading-[1.5] text-ink-muted">{ROLE_HELP[org.role]}</p>
				</SettingsRow>
				<SettingsRow label="Team">
					<TeamSummary isAdmin={isAdmin} />
				</SettingsRow>
			</SettingsCard>
			<PlanSummary isAdmin={isAdmin} />
		</div>
	);
}

// The name field and Save. Checked here with the API's own rules before sending; the API's answer (403, a name it
// refuses) shows under the field. Escape puts the saved name back.
function RenameForm({ inputId, name }: { inputId: string; name: string }) {
	const rename = useRenameOrg();
	const toast = useToast();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(name);
	const [error, setError] = useState<string | null>(null);
	// After a refused save the field re-checks as you type, so the message goes as soon as the name is fine.
	const [checking, setChecking] = useState(false);
	const hintId = `${inputId}-hint`;
	const errorId = `${inputId}-error`;
	// The saved name the field was last filled from. When it changes (this save, or a rename from another tab) the
	// field takes the new name, unless you are in the middle of typing a different one.
	const [filledFrom, setFilledFrom] = useState(name);
	if (filledFrom !== name) {
		setFilledFrom(name);
		const typed = cleanOrgName(value) ?? value;
		if (typed === filledFrom || typed === name) setValue(name);
	}
	const cleaned = cleanOrgName(value);
	const changed = (cleaned ?? value.trim()) !== name;

	const refuse = (message: string) => {
		setError(message);
		setChecking(true);
		inputRef.current?.focus();
	};

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (rename.isPending || !changed) return;
		if (!cleaned) {
			refuse(`${ORG_NAME_HINT}.`);
			return;
		}
		rename.mutate(cleaned, {
			// The cached account takes the new name, so the field, the sidebar and the header all show it.
			onSuccess: (org) => toast.show(`Company renamed to ${org.name}`),
			onError: (failure) => refuse(failure.message),
		});
	};

	const onChange = (next: string) => {
		setValue(next);
		if (checking) setError(cleanOrgName(next) ? null : `${ORG_NAME_HINT}.`);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Escape" || !changed) return;
		event.preventDefault();
		event.stopPropagation();
		setValue(name);
		setError(null);
		setChecking(false);
	};

	return (
		<form noValidate onSubmit={submit} className="flex flex-wrap items-start gap-3">
			<div className="min-w-0 flex-[1_1_240px] @min-[640px]:max-w-[420px]">
				<input
					ref={inputRef}
					id={inputId}
					name="company"
					autoComplete="organization"
					className="field"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={onKeyDown}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `${errorId} ${hintId}` : hintId}
				/>
				{error && (
					<p id={errorId} className="mt-2 text-[14px] text-gap-ink">
						✕ {error}
					</p>
				)}
				{/* The error already says how long a name can be, so the hint drops that part while it shows. */}
				<p id={hintId} className="mt-2 text-[13px] text-ink-muted">
					{error ? "" : `${ORG_NAME_MIN} to ${ORG_NAME_MAX} characters. `}
					{changed ? "Press Escape to undo." : ""}
				</p>
			</div>
			<button
				type="submit"
				// Nothing to save yet: a quiet outline. Once the name changes it becomes the primary button.
				className={`btn min-h-11 ${!changed && !rename.isPending ? "ghost cursor-default" : ""}`}
				aria-disabled={!changed || rename.isPending}
			>
				{rename.isPending ? "Saving" : "Save"}
			</button>
		</form>
	);
}

// "3 people · 1 admin · 1 pending invite" with their faces, and the way to the Team page.
function TeamSummary({ isAdmin }: { isAdmin: boolean }) {
	const team = useTeam();
	const invites = useInvites(isAdmin);
	if (team.isPending) return <Skeleton className="mt-1 h-4 w-56" label="Loading your team" />;
	if (team.isError) return <CardError message={team.error.message} onRetry={() => void team.refetch()} />;

	const members = team.data;
	const admins = members.filter((member) => member.role === "admin").length;
	const pending = invites.data?.length ?? 0;
	const faces = members.slice(0, 5);
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
			<span className="flex -space-x-2" aria-hidden="true">
				{faces.map((member) => (
					<span key={member.userId} className="rounded-full ring-2 ring-sheet">
						<Avatar account={member} size={32} />
					</span>
				))}
			</span>
			<div className="min-w-0">
				<p className="text-[15px] text-ink">
					{plural(members.length, "person", "people")} · {plural(admins, "admin", "admins")}
					{pending > 0 && ` · ${plural(pending, "pending invite", "pending invites")}`}
				</p>
				<AppLink
					href="/dashboard/settings/team"
					className="mt-0.5 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold underline underline-offset-[.18em]"
				>
					{isAdmin ? "Invite people and manage roles" : "See who's on the team"}
					<ArrowRight size={16} aria-hidden="true" />
				</AppLink>
			</div>
		</div>
	);
}

// The usage numbers in one mono line: "Jobs this month 3 of 10 · Busiest job 4 of 10 CVs · AI this hour 5 of 30".
function usageLine({ usage }: Billing): string {
	const jobs = usage.jobsLimit === null ? `${formatNumber(usage.jobsThisMonth)}, no limit` : `${formatNumber(usage.jobsThisMonth)} of ${formatNumber(usage.jobsLimit)}`;
	return [
		`Jobs this month ${jobs}`,
		`Busiest job ${formatNumber(usage.busiestJob?.cvCount ?? 0)} of ${formatNumber(usage.cvLimit)} CVs`,
		`AI this hour ${formatNumber(usage.aiThisHour)} of ${formatNumber(usage.aiLimit)}`,
	].join(" · ");
}

// The plan at a glance: its name, its status, what happens next and the usage, with the way to Plan & billing.
function PlanSummary({ isAdmin }: { isAdmin: boolean }) {
	const query = useBilling();
	const billing = query.data;
	return (
		<SettingsCard
			title="Plan"
			actions={
				<AppLink href="/dashboard/settings/billing" className="btn ghost">
					{isAdmin ? "Manage plan" : "See plan and usage"}
				</AppLink>
			}
		>
			{query.isPending ? (
				<Skeleton lines={2} className="h-4 w-72 max-w-full" label="Loading your plan" />
			) : !billing ? (
				<CardError message={query.error?.message ?? "We couldn't load your plan."} onRetry={() => void query.refetch()} />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p className="font-display text-[26px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
							<span className="sr-only">Current plan:</span>{" "}
							<span className="mk">{PLANS[billing.effectivePlan].name}</span>
						</p>
						<StatusBadge badge={statusBadge(billing)} />
					</div>
					<p className="mt-2 text-[15px] leading-[1.5] text-ink-2">{renewalLine(billing)}</p>
					<p className="mt-3 font-mono text-[12.5px] leading-[1.5] text-ink-muted">{usageLine(billing)}</p>
				</>
			)}
		</SettingsCard>
	);
}
