import { type KeyboardEvent, type ReactNode, createContext, use, useId, useRef } from "react";
import { CountBadge } from "./count-badge.tsx";

type TabsContextValue = { value: string; select: (value: string) => void; base: string; activation: "automatic" | "manual" };
const TabsContext = createContext<TabsContextValue | null>(null);

const useTabs = () => {
	const tabs = use(TabsContext);
	if (!tabs) throw new Error("Tab and TabPanel go inside <Tabs>");
	return tabs;
};
// Values can hold characters that ids can't.
const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

// Tabs with a controlled value, so a page can keep the chosen tab in the URL (`?tab=description`). The tab list
// has one tab stop; arrow keys, Home and End move between tabs and choose them (`activation="manual"` waits for
// Enter or Space instead).
//
//   <Tabs value={tab} onChange={(next) => navigate({ search: { tab: next }, replace: true })}>
//     <TabList label="Job">
//       <Tab value="candidates" count={14}>Candidates</Tab>
//       <Tab value="description">Description</Tab>
//     </TabList>
//     <TabPanel value="candidates">…</TabPanel>
//     <TabPanel value="description">…</TabPanel>
//   </Tabs>
export function Tabs<T extends string>({
	value,
	onChange,
	activation = "automatic",
	children,
}: {
	value: T;
	onChange: (value: T) => void;
	activation?: "automatic" | "manual";
	children: ReactNode;
}) {
	const base = useId();
	return (
		<TabsContext value={{ value, select: (next) => onChange(next as T), base, activation }}>{children}</TabsContext>
	);
}

// The row of tabs, with a 1px line under it.
export function TabList({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
	const { select, activation } = useTabs();
	const ref = useRef<HTMLDivElement>(null);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [])];
		const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		const targets: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
		if (!(event.key in targets)) return;
		event.preventDefault();
		const next = tabs[(targets[event.key] + tabs.length) % tabs.length];
		next.focus();
		if (activation === "automatic" && next.dataset.value) select(next.dataset.value);
	};
	return (
		<div ref={ref} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`tablist ${className}`}>
			{children}
		</div>
	);
}

// One tab. `count` adds a count badge after the label ("Candidates 14"); it is read as part of the name.
export function Tab({
	value,
	count,
	disabled = false,
	children,
}: {
	value: string;
	count?: number;
	disabled?: boolean;
	children: ReactNode;
}) {
	const tabs = useTabs();
	const selected = tabs.value === value;
	return (
		<button
			type="button"
			role="tab"
			id={`${tabs.base}-tab-${slug(value)}`}
			aria-controls={`${tabs.base}-panel-${slug(value)}`}
			aria-selected={selected}
			tabIndex={selected ? 0 : -1}
			disabled={disabled}
			data-value={value}
			onClick={() => tabs.select(value)}
			className="tab"
		>
			{children}
			{count !== undefined && <CountBadge count={count} showZero />}
		</button>
	);
}

// What a tab shows. Only the chosen panel renders. The panel takes focus itself unless `focusable` is false, for a
// panel that opens with a field or button Tab reaches anyway.
export function TabPanel({
	value,
	children,
	focusable = true,
	className = "",
}: {
	value: string;
	children: ReactNode;
	focusable?: boolean;
	className?: string;
}) {
	const tabs = useTabs();
	if (tabs.value !== value) return null;
	return (
		<div
			role="tabpanel"
			id={`${tabs.base}-panel-${slug(value)}`}
			aria-labelledby={`${tabs.base}-tab-${slug(value)}`}
			tabIndex={focusable ? 0 : undefined}
			className={`focus-visible:outline-offset-4 ${className}`}
		>
			{children}
		</div>
	);
}
