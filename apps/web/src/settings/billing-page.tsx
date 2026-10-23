import { PLANS, type PaidPlanKey, type PlanKey, planFeatures, planRank } from "@lucid-hire/plans";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { type Billing, BILLING_POLL_LIMIT_MS, useBilling, useCheckout, usePortal } from "../lib/billing.ts";
import { formatNumber } from "../lib/format.ts";
import { redirectTo } from "../lib/redirect.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AppLink } from "../ui/app-link.tsx";
import { Meter } from "../ui/meter.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { renewalLine, statusBadge } from "./plan-status.ts";
import { CardError, SettingsCard, StatusBadge } from "./settings-ui.tsx";

const PLAN_ORDER: PlanKey[] = ["free", "pro", "max"];
// The marker CTA band's torn top and bottom edges (design system §3), the same polygon as the landing page's band.
const TORN_EDGES =
	"polygon(0 3%,14% 1.2%,33% 2.6%,56% .6%,78% 2.2%,100% .8%,100% 97.4%,82% 99.2%,61% 97.6%,39% 99.4%,17% 97.8%,0 99%)";

type Waiting = PlanKey | "paid" | null;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
// Where a checkout or portal error shows: next to the button that was pressed.
type ErrorSpot = "header" | "band" | "plans";

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

type PlanWatch = ReturnType<typeof usePlanWatch>;

// The usage allowance closest to its limit, as a sentence for the upgrade band, or null when everything has room.
function pressingLimit({ usage, effectivePlan }: Billing): string | null {
	const near = (used: number, limit: number) => limit > 0 && used / limit >= 0.9;
	if (usage.busiestJob && near(usage.busiestJob.cvCount, usage.cvLimit)) {
		const { title, cvCount } = usage.busiestJob;
		return `${title} has used ${formatNumber(cvCount)} of its ${formatNumber(usage.cvLimit)} ${effectivePlan === "free" ? "free " : ""}CVs`;
	}
	if (usage.jobsLimit !== null && near(usage.jobsThisMonth, usage.jobsLimit)) {
		return `${formatNumber(usage.jobsThisMonth)} of ${formatNumber(usage.jobsLimit)} new jobs used this month`;
	}
	if (near(usage.aiThisHour, usage.aiLimit)) return `${formatNumber(usage.aiThisHour)} of ${formatNumber(usage.aiLimit)} AI requests used this hour`;
	return null;
}

// "20 jobs a month, 150 AI requests an hour and priority in the reading queue": a plan's features after its CVs.
function featureSentence(plan: PlanKey): string {
	const [, ...rest] = planFeatures(PLANS[plan]).map((feature, index) =>
		index === 0 ? feature : feature[0].toLowerCase() + feature.slice(1),
	);
	return `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`;
}

// Settings → Plan & billing: the current plan and what happens next, the usage against each limit, an upgrade prompt
// when it helps, and the three plans side by side. Admins change the plan (Polar checkout, or the billing portal for
// downgrades and payment details); members see everything and are told who can change it. After Polar's checkout
// (`?checkout=success`) or a plan change, it waits for the new plan to land and says so.
export function BillingPage({ checkout, upgrade }: { checkout: boolean; upgrade: PaidPlanKey | undefined }) {
	useDocumentTitle("Plan & billing · LucidHire");
	const watch = usePlanWatch(checkout ? "paid" : null);
	const { billing: query, setWaitingFor } = watch;
	const checkoutMutation = useCheckout();
	const portal = usePortal();
	const [errorSpot, setErrorSpot] = useState<ErrorSpot>("header");
	const billing = query.data;

	const openPortal = (spot: ErrorSpot) => {
		if (portal.isPending) return;
		setErrorSpot(spot);
		checkoutMutation.reset();
		portal.mutate(undefined, { onSuccess: ({ url }) => redirectTo(url) });
	};
	const choose = (plan: PaidPlanKey, spot: ErrorSpot) => {
		if (checkoutMutation.isPending) return;
		setErrorSpot(spot);
		portal.reset();
		checkoutMutation.mutate(plan, {
			onSuccess: (result) => {
				if (result.url) redirectTo(result.url);
				else setWaitingFor(plan);
			},
		});
	};

	// The Current plan card stays in place from the first paint; only its body changes from loading to loaded, so
	// nothing jumps and a screen reader keeps its place.
	const header = (body: ReactNode) => (
		<SettingsCard
			title="Current plan"
			actions={
				billing?.isAdmin &&
				billing.status !== null && (
					<button type="button" className="btn ghost" onClick={() => openPortal("header")} aria-disabled={portal.isPending}>
						{portal.isPending ? "Opening billing" : "Manage billing"}
					</button>
				)
			}
		>
			{body}
		</SettingsCard>
	);
	if (!billing) {
		return (
			<div className="grid gap-6">
				{header(
					query.isPending ? (
						<Skeleton lines={3} className="h-4 w-80 max-w-full" label="Loading your plan" />
					) : (
						<CardError message={query.error?.message ?? "We couldn't load your plan."} onRetry={() => void query.refetch()} />
					),
				)}
			</div>
		);
	}

	const failure = checkoutMutation.error ?? portal.error;
	const errorAt = (spot: ErrorSpot) =>
		failure && errorSpot === spot ? (
			<p role="alert" className="mt-4 text-[14px] text-gap-ink">
				✕ {failure.message}
			</p>
		) : null;
	const picked = upgrade && planRank(upgrade) > planRank(billing.effectivePlan) ? upgrade : undefined;
	const waiting = watch.waitingFor !== null && !watch.done && !watch.timedOut;
	// The band offers the next plan up (or the one picked on the pricing section) to admins who can use it: on Free,
	// when something is near its limit, or when they arrived with a plan in mind.
	const nextUp = PLAN_ORDER[planRank(billing.effectivePlan) + 1] as PaidPlanKey | undefined;
	const offer = picked ?? nextUp;
	const reason = pressingLimit(billing);
	const showBand = billing.isAdmin && offer && !waiting && (picked || reason || billing.effectivePlan === "free");

	return (
		<div className="grid gap-6">
			{header(
				<>
					<CurrentPlan billing={billing} watch={watch} />
					{errorAt("header")}
				</>,
			)}
			<Usage billing={billing} />
			{showBand && offer && (
				<UpgradeBand
					plan={offer}
					billing={billing}
					eyebrow={picked ? `You picked ${PLANS[picked].name}` : (reason ?? `On Free · ${formatNumber(PLANS.free.cvsPerJob)} CVs a job`)}
					busy={checkoutMutation.isPending && checkoutMutation.variables === offer}
					onChoose={() => choose(offer, "band")}
					onCompare={() => {
						const heading = document.getElementById("compare-h");
						heading?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
						heading?.focus({ preventScroll: true });
					}}
				>
					{errorAt("band")}
				</UpgradeBand>
			)}
			<section aria-labelledby="compare-h" className="pt-2">
				<h2 id="compare-h" tabIndex={-1} className="scroll-mt-6 text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%] focus:outline-none">
					Compare plans
				</h2>
				<p className="mt-1.5 text-[15px] text-ink-muted">
					{billing.isAdmin
						? "Prices are in US dollars a month. Upgrades go through Polar's checkout; downgrades and cancelling are in the billing portal."
						: "Only admins can change the plan. Ask one of them if you need more room."}
				</p>
				<div role="list" aria-labelledby="compare-h" className="mt-6 grid max-w-[520px] gap-5 @min-[720px]:max-w-none @min-[720px]:grid-cols-3">
					{PLAN_ORDER.map((key) => (
						<PlanCard
							key={key}
							plan={key}
							billing={billing}
							picked={picked === key}
							offered={offer === key}
							busy={checkoutMutation.isPending && checkoutMutation.variables === key}
							onChoose={(plan) => choose(plan, "plans")}
							onPortal={() => openPortal("plans")}
						/>
					))}
				</div>
				{errorAt("plans")}
			</section>
		</div>
	);
}

// The plan's name (marked), its status, the price and what happens next, the payment-failed and checkout notices.
function CurrentPlan({ billing, watch }: { billing: Billing; watch: PlanWatch }) {
	const name = PLANS[billing.effectivePlan].name;
	const pastDue = billing.status === "past_due";
	const cancelling = billing.cancelAtPeriodEnd && billing.currentPeriodEnd && billing.effectivePlan !== "free";
	return (
		<>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<p className="font-display text-[clamp(30px,3.4vw,40px)] leading-none font-[820] tracking-[-0.03em] [font-stretch:112%]">
					<span className="mk">{name}</span>
				</p>
				<StatusBadge badge={statusBadge(billing)} />
			</div>
			{!pastDue && (
				<p className="mt-3 text-[16px] leading-[1.5] text-ink-2">
					{renewalLine(billing)}
					{cancelling && billing.isAdmin && " You can undo this in the billing portal."}
				</p>
			)}
			{billing.isAdmin && billing.status !== null && (
				<p className="mt-1 font-mono text-[12.5px] leading-[1.5] text-ink-muted">
					Invoices, the payment method and cancelling are in Polar's billing portal.
				</p>
			)}
			{!billing.isAdmin && <p className="mt-1 text-[14px] text-ink-muted">Only admins can change the plan.</p>}
			{pastDue && (
				<div role="alert" className="mt-4 rounded-lg bg-gap-soft p-4 text-[15px] text-ink">
					<p className="font-semibold">✕ Your last payment failed.</p>
					<p className="mt-1 text-ink-2">
						{billing.isAdmin
							? "Update your payment method in the billing portal to keep your plan."
							: "Ask an admin to update the payment method in the billing portal."}
					</p>
				</div>
			)}
			<PlanNotice watch={watch} />
		</>
	);
}

// What the page is waiting for after a payment or a plan change, in the status pill (live dot while it waits).
function PlanNotice({ watch }: { watch: PlanWatch }) {
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
			className="mt-4 inline-flex min-h-11 items-center gap-2.5 rounded-md bg-ink px-3.5 py-2 font-mono text-[13.5px] leading-[1.35] text-paper"
		>
			{!done && !timedOut && <span className="live-dot" aria-hidden="true" style={{ background: "var(--paper)" }} />}
			{done && <Check />}
			{message}
		</p>
	);
}

// One allowance: a meter when there is a limit (from 90% it turns gap-ink and says so), plain words when there
// isn't, and a line about how it counts.
function UsageItem({
	label,
	used,
	limit,
	valueText,
	warning,
	children,
}: {
	label: string;
	used: number;
	limit: number | null;
	valueText: string;
	warning?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			{limit === null ? (
				<div className="flex items-baseline justify-between gap-3">
					<span className="text-[14px] font-semibold text-ink">{label}</span>
					<span className="font-mono text-[13px] text-ink-muted tabular-nums">{valueText}</span>
				</div>
			) : (
				<Meter label={label} value={used} max={limit} valueText={valueText} warning={warning} />
			)}
			{children && <div className="text-[13px] leading-[1.5] text-ink-muted">{children}</div>}
		</div>
	);
}

function Usage({ billing }: { billing: Billing }) {
	const { usage, effectivePlan } = billing;
	const busiest = usage.busiestJob;
	const cvCount = busiest?.cvCount ?? 0;
	const jobsFull = usage.jobsLimit !== null && usage.jobsThisMonth >= usage.jobsLimit;
	return (
		<SettingsCard title="Usage" description="Counted in UTC: new jobs per calendar month, AI requests per clock hour.">
			<div className="grid gap-x-8 gap-y-7 @min-[720px]:grid-cols-3">
				<UsageItem
					label="New jobs this month"
					used={usage.jobsThisMonth}
					limit={usage.jobsLimit}
					valueText={
						usage.jobsLimit === null
							? `Unlimited · ${formatNumber(usage.jobsThisMonth)} created`
							: `${formatNumber(usage.jobsThisMonth)} of ${formatNumber(usage.jobsLimit)}`
					}
					warning={jobsFull ? "Limit reached. Deleting a job does not give the slot back." : undefined}
				>
					{!jobsFull && "Counts jobs created, so deleting one does not free a slot."}
				</UsageItem>
				<UsageItem
					label="CVs on the busiest job"
					used={cvCount}
					limit={usage.cvLimit}
					valueText={`${formatNumber(cvCount)} of ${formatNumber(usage.cvLimit)}`}
					warning={cvCount >= usage.cvLimit ? "Limit reached on this job" : undefined}
				>
					{busiest ? (
						<>
							<AppLink
								href={`/dashboard/jobs/${encodeURIComponent(busiest.id)}`}
								className="font-semibold text-ink underline underline-offset-[.18em] [overflow-wrap:anywhere]"
							>
								{busiest.title}
							</AppLink>
							. Every job reads up to {formatNumber(usage.cvLimit)} {effectivePlan === "free" ? "free " : ""}CVs.
						</>
					) : (
						"No CVs uploaded yet."
					)}
				</UsageItem>
				<UsageItem
					label="AI requests this hour"
					used={usage.aiThisHour}
					limit={usage.aiLimit}
					valueText={`${formatNumber(usage.aiThisHour)} of ${formatNumber(usage.aiLimit)}`}
					warning={usage.aiThisHour >= usage.aiLimit ? "Limit reached. It resets at the top of the hour." : undefined}
				>
					{usage.aiThisHour < usage.aiLimit && "Improve with AI and interview questions. Scoring is not counted."}
				</UsageItem>
			</div>
		</SettingsCard>
	);
}

// The upgrade prompt on the marker CTA band (design system §3: in the app, only here): why now, what the next plan
// gives, and one button. Text on the band keeps the light inks in dark mode.
function UpgradeBand({
	plan,
	billing,
	eyebrow,
	busy,
	onChoose,
	onCompare,
	children,
}: {
	plan: PaidPlanKey;
	billing: Billing;
	eyebrow: string;
	busy: boolean;
	onChoose: () => void;
	onCompare: () => void;
	children?: ReactNode;
}) {
	const config = PLANS[plan];
	const paying = billing.effectivePlan !== "free";
	return (
		<section
			aria-labelledby="upgrade-h"
			className="on-marker-area bg-marker px-5 py-10 text-on-marker @min-[561px]:px-10 @min-[561px]:py-12"
			style={{ clipPath: TORN_EDGES }}
		>
			<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-2 uppercase">{eyebrow}</p>
			<h2
				id="upgrade-h"
				className="mt-3 font-display text-[clamp(26px,3.2vw,40px)] leading-[1.02] font-[820] tracking-[-0.035em] text-balance [font-stretch:112%]"
			>
				Read {formatNumber(config.cvsPerJob)} CVs a job with {config.name}
			</h2>
			<p className="mt-3 max-w-[58ch] text-[16px] leading-[1.55] text-ink-2">
				${config.priceUsd} a month for {featureSentence(plan)}.{" "}
				{paying ? "The change applies straight away." : "Nothing is charged until you confirm in Polar's checkout."} You can
				cancel any time in the billing portal.
			</p>
			<div className="mt-6 flex flex-wrap items-center gap-3">
				<button type="button" className="btn" onClick={onChoose} aria-disabled={busy}>
					{busy ? "Opening checkout" : `Upgrade to ${config.name}`}
				</button>
				<button type="button" className="btn ghost" onClick={onCompare}>
					Compare plans
				</button>
			</div>
			{children}
		</section>
	);
}

// One plan (design system §4: plan card). The plan picked on the pricing section is the selected card: ink border,
// lifted 4px with the lift shadow, its name marked. The current plan has an ink border and says so.
function PlanCard({
	plan,
	billing,
	picked,
	offered,
	busy,
	onChoose,
	onPortal,
}: {
	plan: PlanKey;
	billing: Billing;
	picked: boolean;
	// The plan the page suggests (picked, or the next one up): its button is the primary one.
	offered: boolean;
	busy: boolean;
	onChoose: (plan: PaidPlanKey) => void;
	onPortal: () => void;
}) {
	const config = PLANS[plan];
	const current = plan === billing.effectivePlan;
	const higher = planRank(plan) > planRank(billing.effectivePlan);
	const ref = useRef<HTMLElement>(null);

	// Arriving with a plan picked on the pricing section brings its card into view (it's below the fold on a phone).
	useEffect(() => {
		if (!picked) return;
		ref.current?.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
	}, [picked]);

	return (
		<article
			ref={ref}
			role="listitem"
			aria-label={`${config.name} plan`}
			className={`relative flex flex-col rounded-xl border-[1.5px] bg-sheet px-6 pt-[26px] pb-6 transition-[border-color,transform,box-shadow] duration-400 ease-out ${picked ? "-translate-y-1 border-ink shadow-lift" : current ? "border-ink" : "border-line"}`}
		>
			{(picked || current) && (
				<span
					className={`absolute -top-[13px] right-[18px] rounded-sm px-2.5 py-1.5 font-mono text-[11px] leading-none tracking-[.04em] ${picked ? "border border-on-marker bg-on-marker text-marker dark:border-line" : "border border-line bg-paper text-ink-2"}`}
				>
					{picked ? `You picked ${config.name}` : "Current plan"}
				</span>
			)}
			<h3 className="font-display text-[26px] leading-none font-[800] tracking-[-0.02em] [font-stretch:112%]">
				{picked ? <span className="mk">{config.name}</span> : config.name}
			</h3>
			<p className="mt-4 flex items-baseline gap-1.5">
				<b className="font-display text-[64px] leading-[.9] font-[800] tracking-[-0.01em] [font-stretch:66%]">${config.priceUsd}</b>
				<span className="font-mono text-[12px] text-ink-muted">{config.priceUsd === 0 ? "no card" : "a month"}</span>
			</p>
			<ul className="mt-[22px] mb-[26px] grid gap-2.5 border-t border-line pt-[18px]">
				{planFeatures(config).map((feature) => (
					<li key={feature} className="grid grid-cols-[18px_1fr] gap-2.5 text-[15.5px] leading-[1.35]">
						<span className="mt-0.5">
							<Check />
						</span>
						{feature}
					</li>
				))}
			</ul>
			<div className="mt-auto">
				{current ? (
					<p className="font-mono text-[12.5px] leading-[1.4] text-ink-muted">You're on this plan.</p>
				) : !billing.isAdmin ? null : higher ? (
					<button
						type="button"
						className={`btn w-full !whitespace-normal ${offered ? "" : "ghost"}`}
						onClick={() => onChoose(plan as PaidPlanKey)}
						aria-disabled={busy}
					>
						{busy ? "Opening checkout" : `Upgrade to ${config.name}`}
					</button>
				) : (
					<button type="button" className="btn ghost w-full !whitespace-normal" onClick={onPortal}>
						Switch to {config.name} in the billing portal
					</button>
				)}
			</div>
		</article>
	);
}
