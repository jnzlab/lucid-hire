import { PLANS, type PlanKey, planFeatures, planRank } from "@lucid-hire/plans";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Check } from "../components/icons.tsx";
import { type Billing, BILLING_POLL_LIMIT_MS, useBilling, useCheckout, usePortal } from "../lib/billing.ts";
import { formatDate, formatNumber } from "../lib/format.ts";
import { redirectTo } from "../lib/redirect.ts";

const PLAN_ORDER: PlanKey[] = ["free", "pro", "max"];

import { type Badge, statusBadge } from "./plan-status.ts";

function StatusBadge({ badge }: { badge: Badge }) {
	return (
		<span
			className={`inline-flex min-h-7 items-center gap-2 rounded-md border px-2.5 font-mono text-[12.5px] ${badge.tone === "warn" ? "border-gap-ink text-gap-ink" : "border-line bg-sheet text-ink"}`}
		>
			<i
				className={`size-2 rounded-full ${badge.tone === "ok" ? "bg-ink" : badge.tone === "warn" ? "bg-gap-ink" : "bg-ink-faint"}`}
				aria-hidden="true"
			/>
			{badge.label}
		</span>
	);
}

function Meter({
	label,
	value,
	limit,
	valueText,
	children,
}: {
	label: string;
	value: number;
	// Null when unlimited.
	limit: number | null;
	valueText: string;
	children?: ReactNode;
}) {
	const percent = limit ? Math.min(100, (value / limit) * 100) : 0;
	const full = limit !== null && value >= limit;
	return (
		<div>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<p className="text-[14px] font-semibold text-ink">{label}</p>
				<p className="font-mono text-[13px] text-ink">{valueText}</p>
			</div>
			{limit !== null && (
				<div
					role="meter"
					aria-label={label}
					aria-valuemin={0}
					aria-valuemax={limit}
					aria-valuenow={Math.min(value, limit)}
					aria-valuetext={valueText}
					className="mt-2 h-2.5 overflow-hidden rounded-sm bg-line-2"
				>
					<div className={`h-full ${full ? "bg-gap-ink" : "bg-ink"}`} style={{ width: `${percent}%` }} />
				</div>
			)}
			{children && <div className="mt-2 text-[13px] text-ink-muted">{children}</div>}
		</div>
	);
}

export function UsageMeters({ billing }: { billing: Billing }) {
	const { usage, effectivePlan } = billing;
	const jobsFull = usage.jobsLimit !== null && usage.jobsThisMonth >= usage.jobsLimit;
	const busiest = usage.busiestJob;
	const cvCount = busiest?.cvCount ?? 0;
	const cvFull = cvCount >= usage.cvLimit;

	return (
		<div className="mt-6 grid gap-6 min-[900px]:grid-cols-3">
			<Meter
				label="New jobs this month (UTC)"
				value={usage.jobsThisMonth}
				limit={usage.jobsLimit}
				valueText={
					usage.jobsLimit === null
						? `Unlimited · ${formatNumber(usage.jobsThisMonth)} created`
						: `${formatNumber(usage.jobsThisMonth)} of ${formatNumber(usage.jobsLimit)}`
				}
			>
				{jobsFull ? (
					<p className="text-gap-ink">✕ Limit reached. Deleting a job does not give the slot back.</p>
				) : (
					<p>Counts jobs created, so deleting one does not free a slot.</p>
				)}
			</Meter>
			<Meter
				label="CV uploads (busiest job)"
				value={cvCount}
				limit={usage.cvLimit}
				valueText={`${formatNumber(cvCount)} of ${formatNumber(usage.cvLimit)} ${effectivePlan === "free" ? "free " : ""}CVs used`}
			>
				{busiest ? (
					<p>
						{cvFull && <span className="text-gap-ink">✕ Limit reached · </span>}
						<Link to="/dashboard/jobs/$jobId" params={{ jobId: busiest.id }} className="underline underline-offset-[.18em]">
							{busiest.title}
						</Link>
					</p>
				) : (
					<p>No CVs uploaded yet.</p>
				)}
			</Meter>
			<Meter
				label="AI requests this hour (UTC)"
				value={usage.aiThisHour}
				limit={usage.aiLimit}
				valueText={`${formatNumber(usage.aiThisHour)} of ${formatNumber(usage.aiLimit)}`}
			>
				{usage.aiThisHour >= usage.aiLimit ? (
					<p className="text-gap-ink">✕ Limit reached. It resets at the top of the hour.</p>
				) : (
					<p>Improve with AI and interview questions. Scoring is not counted.</p>
				)}
			</Meter>
		</div>
	);
}

type Waiting = PlanKey | "paid" | null;

// Keeps asking for the plan after a payment or a plan change, until the webhook has landed, up to a minute.
function usePlanWatch(initial: Waiting) {
	const [waitingFor, setWaitingFor] = useState<Waiting>(initial);
	// The plan the one-minute wait ran out for; waiting for something new starts a fresh minute.
	const [timedOutFor, setTimedOutFor] = useState<Waiting>(null);
	const timedOut = waitingFor !== null && timedOutFor === waitingFor;
	const reached = (billing: Billing | undefined) =>
		billing !== undefined && (waitingFor === "paid" ? billing.effectivePlan !== "free" : billing.effectivePlan === waitingFor);

	useEffect(() => {
		if (!waitingFor) return;
		const timer = setTimeout(() => setTimedOutFor(waitingFor), BILLING_POLL_LIMIT_MS);
		return () => clearTimeout(timer);
	}, [waitingFor]);

	const billing = useBilling({ alwaysFresh: true, pollWhile: (data) => waitingFor !== null && !timedOut && !reached(data) });
	const done = reached(billing.data);
	return { billing, waitingFor, setWaitingFor, timedOut: timedOut && !done, done };
}

function PlanNotice({ watch }: { watch: ReturnType<typeof usePlanWatch> }) {
	const { waitingFor, timedOut, done, billing } = watch;
	if (!waitingFor || !billing.data) return null;
	const name = PLANS[billing.data.effectivePlan].name;
	const message = done
		? waitingFor === "paid"
			? `Your ${name} plan is active.`
			: `You're on ${name} now.`
		: timedOut
			? "Still activating. This can take a minute; refresh shortly."
			: waitingFor === "paid"
				? "Payment received. Activating your plan…"
				: `Changing your plan to ${PLANS[waitingFor].name}…`;
	return (
		<p
			role="status"
			className="mt-5 inline-flex min-h-11 items-center gap-2.5 rounded-md bg-ink px-3.5 font-mono text-[13.5px] text-paper"
		>
			{!done && !timedOut && <span className="live-dot" aria-hidden="true" style={{ background: "var(--paper)" }} />}
			{message}
		</p>
	);
}

export function PlanSection({ checkout, upgrade }: { checkout: boolean; upgrade: "pro" | "max" | undefined }) {
	const watch = usePlanWatch(checkout ? "paid" : null);
	const { billing: query, setWaitingFor } = watch;
	const checkoutMutation = useCheckout();
	const portal = usePortal();
	const billing = query.data;

	const openPortal = () => {
		if (portal.isPending) return;
		portal.mutate(undefined, { onSuccess: ({ url }) => redirectTo(url) });
	};
	const choose = (plan: "pro" | "max") => {
		if (checkoutMutation.isPending) return;
		checkoutMutation.mutate(plan, {
			onSuccess: (result) => {
				if (result.url) redirectTo(result.url);
				else setWaitingFor(plan);
			},
		});
	};

	return (
		<section id="plan" aria-labelledby="plan-h" className="rounded-xl bg-sheet p-6 shadow-card min-[561px]:p-8">
			<h2 id="plan-h" className="text-[22px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
				Plan &amp; usage
			</h2>
			{query.isPending ? (
				<p role="status" className="mt-5 inline-flex min-h-11 items-center gap-2.5 font-mono text-[13.5px] text-ink">
					<span className="live-dot" aria-hidden="true" />
					Loading your plan
				</p>
			) : !billing ? (
				<div role="alert" className="mt-5 flex flex-col items-start gap-3">
					<p className="text-[15px] text-gap-ink">✕ {query.error?.message ?? "We couldn't load your plan."}</p>
					<button type="button" className="btn" onClick={() => void query.refetch()}>
						Try again
					</button>
				</div>
			) : (
				<>
					<div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
						<p className="text-[15px] text-ink-2">
							Current plan{" "}
							<b className="font-display text-[22px] font-[800] text-ink [font-stretch:108%]">
								<span className="mk">{PLANS[billing.effectivePlan].name}</span>
							</b>
						</p>
						<StatusBadge badge={statusBadge(billing)} />
						{billing.isAdmin && billing.status !== null && (
							<button type="button" className="btn ghost" onClick={openPortal} aria-disabled={portal.isPending}>
								{portal.isPending ? "Opening billing" : "Manage billing"}
							</button>
						)}
					</div>
					<PlanNotice watch={watch} />

					{billing.status === "past_due" && (
						<div role="alert" className="mt-5 rounded-lg bg-gap-soft p-4 text-[15px] text-ink">
							<p className="font-semibold">✕ Your last payment failed.</p>
							<p className="mt-1 text-ink-2">
								{billing.isAdmin
									? "Update your payment method in the billing portal to keep your plan."
									: "Ask an admin to update the payment method in the billing portal."}
							</p>
						</div>
					)}
					{billing.cancelAtPeriodEnd && billing.currentPeriodEnd && billing.effectivePlan !== "free" && (
						<p className="mt-5 text-[15px] text-ink-2">
							Your {PLANS[billing.effectivePlan].name} plan ends on {formatDate(billing.currentPeriodEnd)}, then you
							are on Free. {billing.isAdmin ? "You can undo this in the billing portal." : ""}
						</p>
					)}

					<UsageMeters billing={billing} />

					<h3 className="mt-10 text-[17px] font-[800] [font-stretch:108%]" id="compare-h">
						Compare plans
					</h3>
					{!billing.isAdmin && <p className="mt-2 text-[14px] text-ink-muted">Only admins can change the plan or roles.</p>}
					<div className="mt-4 grid gap-4 min-[900px]:grid-cols-3" aria-labelledby="compare-h" role="list">
						{PLAN_ORDER.map((key) => (
							<PlanCard
								key={key}
								plan={key}
								billing={billing}
								picked={upgrade === key && planRank(key) > planRank(billing.effectivePlan)}
								busy={checkoutMutation.isPending && checkoutMutation.variables === key}
								onChoose={choose}
								onPortal={openPortal}
							/>
						))}
					</div>
					{(checkoutMutation.isError || portal.isError) && (
						<p role="alert" className="mt-4 text-[14px] text-gap-ink">
							✕ {(checkoutMutation.error ?? portal.error)?.message}
						</p>
					)}
				</>
			)}
		</section>
	);
}

function PlanCard({
	plan,
	billing,
	picked,
	busy,
	onChoose,
	onPortal,
}: {
	plan: PlanKey;
	billing: Billing;
	picked: boolean;
	busy: boolean;
	onChoose: (plan: "pro" | "max") => void;
	onPortal: () => void;
}) {
	const config = PLANS[plan];
	const current = plan === billing.effectivePlan;
	const higher = planRank(plan) > planRank(billing.effectivePlan);
	const selected = current || picked;

	return (
		<article
			role="listitem"
			aria-label={`${config.name} plan`}
			className={`flex flex-col rounded-xl border-[1.5px] p-5 ${selected ? "border-ink shadow-lift" : "border-line"} ${picked ? "-translate-y-1" : ""}`}
		>
			<div className="flex items-baseline justify-between gap-2">
				<h4 className="font-display text-[22px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
					{picked ? <span className="mk">{config.name}</span> : config.name}
				</h4>
				{picked && <span className="font-mono text-[12px] text-ink">You picked {config.name}</span>}
			</div>
			<p className="mt-2 text-[15px] text-ink-2">
				<b className="font-display text-[28px] font-[800] text-ink [font-stretch:62%]">${config.priceUsd}</b>
				{config.priceUsd === 0 ? " no card" : " a month"}
			</p>
			<ul className="mt-4 flex-1 space-y-2 text-[14.5px]">
				{planFeatures(config).map((feature) => (
					<li key={feature} className="flex items-start gap-2">
						<span className="mt-[3px] flex-none">
							<Check />
						</span>
						{feature}
					</li>
				))}
			</ul>
			<div className="mt-5">
				{current ? (
					<p className="inline-flex min-h-11 items-center font-mono text-[13px] text-ink">Current plan</p>
				) : higher ? (
					billing.isAdmin && (plan === "pro" || plan === "max") ? (
						<button
							type="button"
							className="btn w-full !whitespace-normal"
							onClick={() => onChoose(plan)}
							aria-disabled={busy}
						>
							{busy ? "Opening checkout" : `Upgrade to ${config.name}`}
						</button>
					) : null
				) : billing.isAdmin ? (
					<button type="button" className="btn ghost w-full !whitespace-normal" onClick={onPortal}>
						Switch to {config.name} in the billing portal
					</button>
				) : null}
			</div>
		</article>
	);
}
