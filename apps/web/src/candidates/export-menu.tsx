import { Download } from "lucide-react";
import { DECISION_LABEL, type ExportChoice } from "../lib/candidates.ts";
import { MenuGroup, MenuItem } from "../ui/menu.tsx";

// The CSVs on offer, by decision. "Undecided" is every CV without a decision, read or not (the API's export filter).
const EXPORT_CHOICES: { value: ExportChoice; label: string }[] = [
	{ value: "all", label: "All candidates" },
	{ value: "shortlisted", label: DECISION_LABEL.shortlisted },
	{ value: "undecided", label: DECISION_LABEL.undecided },
	{ value: "rejected", label: DECISION_LABEL.rejected },
];

// "Export CSV" › All candidates, Shortlisted, Undecided, Not a fit, inside the job page's overflow menu.
export function ExportItems({ pending, onExport }: { pending: boolean; onExport: (choice: ExportChoice) => void }) {
	return (
		<MenuGroup label={pending ? "Exporting" : "Export CSV"}>
			{EXPORT_CHOICES.map(({ value, label }) => (
				<MenuItem key={value} icon={<Download aria-hidden="true" />} disabled={pending} onSelect={() => onExport(value)}>
					{label}
				</MenuItem>
			))}
		</MenuGroup>
	);
}
