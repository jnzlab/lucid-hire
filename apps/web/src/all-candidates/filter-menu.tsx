import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuItem } from "../ui/menu.tsx";
import { filterButton } from "./filter-button.ts";

// One of the toolbar's choices (Status, Minimum score, Sort): a button showing the current choice in words ("Any
// status", "Score 70+") that opens a menu of radio items. `label` names the choice for screen readers.
export function FilterMenu<T extends string>({
	label,
	icon,
	value,
	options,
	active,
	onChange,
}: {
	label: string;
	icon?: ReactNode;
	value: T;
	options: readonly { value: T; label: string }[];
	// Whether the choice narrows the list (a sort never does).
	active: boolean;
	onChange: (value: T) => void;
}) {
	const chosen = options.find((option) => option.value === value) ?? options[0];
	return (
		<Menu
			trigger={(props) => (
				<button {...props} className={filterButton(active)}>
					{icon}
					<span className="truncate">
						<span className="sr-only">{label}:</span>{" "}
						{chosen?.label}
					</span>
					<ChevronDown size={16} aria-hidden="true" className="flex-none text-ink-muted" />
				</button>
			)}
		>
			{options.map((option) => (
				<MenuItem key={option.value} checked={option.value === value} onSelect={() => onChange(option.value)}>
					{option.label}
				</MenuItem>
			))}
		</Menu>
	);
}
