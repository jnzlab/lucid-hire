import { CreditCard, Keyboard, LogOut, UserRound } from "lucide-react";
import { useId } from "react";
import { type ThemePreference, THEME_OPTIONS, useTheme } from "../lib/theme.ts";
import { HOVER_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { AppLink } from "../ui/app-link.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu.tsx";
import { SegmentedControl } from "../ui/segmented-control.tsx";
import { Avatar } from "./avatar.tsx";
import { SETTINGS_PAGES } from "./nav.ts";
import { useShell } from "./shell-context.ts";
import { useAccount } from "./use-account.ts";

const roleName = (role: "admin" | "member") => (role === "admin" ? "Admin" : "Member");

// The sidebar's account button and its menu (ours, not Clerk's UserButton): who you are, the theme, the account and
// billing pages, the shortcuts and Sign out. In the rail it is the avatar alone.
export function AccountMenu({ role, collapsed }: { role: "admin" | "member"; collapsed: boolean }) {
	const account = useAccount();
	const shell = useShell();
	const { preference, setPreference } = useTheme();
	const name = account.name ?? account.email ?? "Your account";

	return (
		<Menu
			side="top"
			align="start"
			className="w-[260px]"
			trigger={(props) => (
				<button
					{...props}
					aria-label={`Account: ${name}, ${roleName(role)}`}
					className={`flex min-h-12 items-center gap-3 rounded-md text-left hover:bg-line-2 aria-expanded:bg-line-2 ${collapsed ? "w-11 justify-center" : "w-full px-2"}`}
				>
					<Avatar account={account} />
					{!collapsed && (
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-[14.5px] leading-[1.25] font-semibold text-ink">{name}</span>
							<span className="font-mono text-[12px] leading-[1.3] text-ink-muted">{roleName(role)}</span>
						</span>
					)}
				</button>
			)}
		>
			<div role="none" className="flex flex-col gap-0.5 px-2.5 pt-2 pb-3">
				<span className="truncate text-[15px] font-semibold text-ink">{name}</span>
				{account.email && account.email !== name && (
					<span className="truncate font-mono text-[12px] text-ink-muted">{account.email}</span>
				)}
			</div>
			<ThemeItems preference={preference} onChange={setPreference} />
			<MenuSeparator />
			<MenuItem href={SETTINGS_PAGES.account} icon={<UserRound />}>
				Account settings
			</MenuItem>
			<MenuItem href={SETTINGS_PAGES.billing} icon={<CreditCard />}>
				Plan &amp; billing
			</MenuItem>
			<MenuItem onSelect={shell.openShortcuts} icon={<Keyboard />} shortcut="?">
				Keyboard shortcuts
			</MenuItem>
			<MenuSeparator />
			<MenuItem href="/sign-out" icon={<LogOut />}>
				Sign out
			</MenuItem>
		</Menu>
	);
}

// The theme as three radio items drawn as one segmented row. They stay in the menu's arrow-key order, and choosing
// one keeps the menu open so you see the change.
function ThemeItems({ preference, onChange }: { preference: ThemePreference; onChange: (next: ThemePreference) => void }) {
	const labelId = useId();
	return (
		<div role="group" aria-labelledby={labelId} className="px-2.5 pb-2">
			<p id={labelId} className="pb-1.5 font-mono text-[11.5px] tracking-[.08em] text-ink-muted uppercase">
				Theme
			</p>
			<div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-paper-2 p-1">
				{THEME_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						role="menuitemradio"
						aria-checked={preference === option.value}
						tabIndex={-1}
						onClick={() => onChange(option.value)}
						className={`min-h-9 rounded-md border-[1.5px] pointer-coarse:min-h-11 text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 ${preference === option.value ? "border-ink bg-sheet text-ink" : "border-transparent text-ink-muted hover:text-ink focus-visible:text-ink"}`}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

// The same account choices for the mobile account sheet, as plain links and a radio group (it is a dialog, not a
// menu). `onNavigate` closes the sheet.
export function AccountPanel({ role, onNavigate }: { role: "admin" | "member"; onNavigate: () => void }) {
	const account = useAccount();
	const shell = useShell();
	const hover = useMediaQuery(HOVER_QUERY, true);
	const name = account.name ?? account.email ?? "Your account";
	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center gap-3">
				<Avatar account={account} size={44} />
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-[16px] font-semibold text-ink">{name}</span>
					<span className="truncate font-mono text-[12.5px] text-ink-muted">
						{[account.email !== name ? account.email : null, roleName(role)].filter(Boolean).join(" · ")}
					</span>
				</div>
			</div>
			<ThemeChoice />
			<ul className="flex flex-col border-t border-line-2 pt-2">
				<li>
					<AppLink href={SETTINGS_PAGES.account} onClick={onNavigate} className="nav-item min-h-12">
						<UserRound size={20} aria-hidden="true" /> Account settings
					</AppLink>
				</li>
				<li>
					<AppLink href={SETTINGS_PAGES.billing} onClick={onNavigate} className="nav-item min-h-12">
						<CreditCard size={20} aria-hidden="true" /> Plan &amp; billing
					</AppLink>
				</li>
				{hover && (
					<li>
						<button
							type="button"
							onClick={() => {
								onNavigate();
								shell.openShortcuts();
							}}
							className="nav-item min-h-12 w-full"
						>
							<Keyboard size={20} aria-hidden="true" /> Keyboard shortcuts
						</button>
					</li>
				)}
				<li>
					<AppLink href="/sign-out" onClick={onNavigate} className="nav-item min-h-12">
						<LogOut size={20} aria-hidden="true" /> Sign out
					</AppLink>
				</li>
			</ul>
		</div>
	);
}

// System, Light or Dark as a segmented radio group, for sheets and the settings page.
export function ThemeChoice() {
	const labelId = useId();
	const { preference, setPreference } = useTheme();
	return (
		<div className="flex flex-col gap-2">
			<p id={labelId} className="font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">
				Theme
			</p>
			<SegmentedControl
				name={`theme-${labelId}`}
				labelledBy={labelId}
				value={preference}
				segments={THEME_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
				onChange={setPreference}
				className="w-full [&>label]:flex-1 [&>label>span]:w-full"
			/>
		</div>
	);
}
