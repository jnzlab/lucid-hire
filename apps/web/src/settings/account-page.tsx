import { UserProfile } from "@clerk/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Check } from "../components/icons.tsx";
import { THEME_OPTIONS, type ThemePreference, useTheme } from "../lib/theme.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { ACCOUNT_PATH } from "./settings-nav.ts";
import { SettingsCard } from "./settings-ui.tsx";

const THEME_ICON: Record<ThemePreference, ReactNode> = {
	system: <Monitor size={20} aria-hidden="true" />,
	light: <Sun size={20} aria-hidden="true" />,
	dark: <Moon size={20} aria-hidden="true" />,
};
const THEME_HINT: Record<ThemePreference, string> = {
	system: "Follows your device",
	light: "Paper and ink",
	dark: "Easier on the eyes at night",
};

// Settings → Account: how the dashboard looks on this device, then the person's own profile, email addresses,
// password, two-step verification and sessions in Clerk's panel (in the Highlighter look through the app-wide
// appearance). Clerk uses path routing under this page, so its own tabs get addresses of their own.
export function AccountPage() {
	useDocumentTitle("Account · LucidHire");
	return (
		<div className="grid gap-6">
			<Appearance />
			<section aria-labelledby="profile-h">
				<h2 id="profile-h" className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
					Profile and security
				</h2>
				<p className="mt-1.5 text-[15px] leading-[1.5] text-ink-muted">
					Your name and photo, email addresses, password, two-step verification and the devices you're signed in on.
				</p>
				<div className="mt-5 min-w-0 [&_.cl-cardBox]:w-full [&_.cl-cardBox]:max-w-full [&_.cl-rootBox]:w-full">
					<UserProfile routing="path" path={ACCOUNT_PATH} />
				</div>
			</section>
		</div>
	);
}

// The theme as three radio cards (real radios, so arrow keys and one tab stop come from the browser). The chosen card
// has an ink border and a check, so colour is never the only signal. It's saved on this device.
function Appearance() {
	const { preference, setPreference } = useTheme();
	const labelId = useId();
	return (
		<SettingsCard title={<span id={labelId}>Appearance</span>} description="Choose how the dashboard looks on this device.">
			<div role="radiogroup" aria-labelledby={labelId} className="grid gap-3 @min-[640px]:grid-cols-3">
				{THEME_OPTIONS.map((option) => {
					const chosen = option.value === preference;
					return (
						<label key={option.value} className="relative block cursor-pointer">
							<input
								type="radio"
								name="theme"
								value={option.value}
								checked={chosen}
								onChange={() => setPreference(option.value)}
								className="peer sr-only"
							/>
							<span
								className={`flex min-h-[76px] items-center gap-3 rounded-lg border-[1.5px] px-4 py-3 transition-colors duration-200 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink ${chosen ? "border-ink bg-sheet" : "border-line bg-paper hover:border-ink-faint"}`}
							>
								<span className={`grid size-10 flex-none place-items-center rounded-md ${chosen ? "bg-marker text-on-marker" : "bg-paper-2 text-ink-2"}`}>
									{THEME_ICON[option.value]}
								</span>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="text-[15px] leading-[1.2] font-[650] text-ink">{option.label}</span>
									<span className="font-mono text-[12px] leading-[1.35] text-ink-muted">{THEME_HINT[option.value]}</span>
								</span>
								{chosen && (
									<span className="flex-none text-ink">
										<Check />
									</span>
								)}
							</span>
						</label>
					);
				})}
			</div>
		</SettingsCard>
	);
}
