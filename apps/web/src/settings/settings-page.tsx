import { useOrg } from "../dashboard/org.ts";
import { PageHeading } from "../jobs/job-ui.tsx";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { AccountSection } from "./account-section.tsx";
import { PlanSection } from "./plan-section.tsx";
import { TeamSection } from "./team-section.tsx";

export function SettingsPage({ checkout, upgrade }: { checkout: boolean; upgrade: "pro" | "max" | undefined }) {
	useDocumentTitle("Settings · LucidHire");
	const org = useOrg();

	return (
		<div className="wrap py-[clamp(32px,5vw,64px)]">
			<PageHeading eyebrow={org.name} title="Settings" />
			<div className="mt-8 grid max-w-[1040px] gap-8">
				<PlanSection checkout={checkout} upgrade={upgrade} />
				<TeamSection isAdmin={org.role === "admin"} />
				<AccountSection />
			</div>
		</div>
	);
}
