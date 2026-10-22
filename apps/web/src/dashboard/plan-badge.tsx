import { PLANS } from "@lucid-hire/plans";
import { Link } from "@tanstack/react-router";
import { useBilling } from "../lib/billing.ts";

// The company's current plan, linking to the plan section of Settings. It shows nothing while the plan loads
// or if it can't be read, so the shell never waits on billing.
export function PlanBadge({ onNavigate }: { onNavigate?: () => void } = {}) {
	const billing = useBilling();
	if (!billing.data) return null;
	const name = PLANS[billing.data.effectivePlan].name;
	return (
		<Link
			to="/dashboard/settings/$"
			hash="plan"
			onClick={onNavigate}
			aria-label={`${name} plan, see plans`}
			className="inline-flex min-h-7 flex-none items-center rounded-md border border-line bg-sheet px-2 font-mono text-[12px] text-ink hover:border-ink"
		>
			{name}
		</Link>
	);
}
