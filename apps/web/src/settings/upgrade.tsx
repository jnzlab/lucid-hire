import { Link } from "@tanstack/react-router";

// The way to the plan cards on the settings page.
export function UpgradeLink({ className = "" }: { className?: string }) {
	return (
		<Link
			to="/dashboard/settings/$"
			hash="plan"
			className={`inline-flex min-h-11 items-center rounded-[3px] font-semibold underline underline-offset-[.18em] ${className}`}
		>
			Upgrade
		</Link>
	);
}

// What to offer when a limit is reached: admins can upgrade, everyone else is pointed at them.
export function UpgradeAction({ isAdmin }: { isAdmin: boolean }) {
	return isAdmin ? <UpgradeLink /> : <span className="text-[14px] text-ink-muted">Ask an admin to upgrade.</span>;
}
