import { PLANS } from "@lucid-hire/plans";
import { useBilling } from "../lib/billing.ts";
import { AppLink } from "../ui/app-link.tsx";
import { SETTINGS_PAGES } from "./nav.ts";

// The company's current plan, linking to Plan & billing. It shows nothing while the plan loads or if it can't be
// read, so the shell never waits on billing.
export function PlanBadge({ onNavigate }: { onNavigate?: () => void } = {}) {
	const billing = useBilling();
	if (!billing.data) return null;
	const name = PLANS[billing.data.effectivePlan].name;
	return (
		<AppLink
			href={SETTINGS_PAGES.billing}
			onClick={onNavigate}
			aria-label={`${name} plan, see plans`}
			className="relative inline-flex min-h-7 flex-none items-center rounded-md after:absolute after:-inset-2 border border-line bg-sheet px-2 font-mono text-[12px] text-ink hover:border-ink"
		>
			{name}
		</AppLink>
	);
}
