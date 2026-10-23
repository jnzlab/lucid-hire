import { useEffect, useSyncExternalStore } from "react";

// Light or dark for the dashboard. The landing page, sign-in, legal and public job pages stay light: the `dark`
// class only goes on <html> while the dashboard is mounted. index.html applies the saved choice before the first
// paint on /dashboard addresses, so there's no flash; keep its inline script in step with this file.
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "lh-theme";
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];
// The browser chrome colour (<meta name="theme-color">) follows the paper token.
const THEME_COLOR: Record<Theme, string> = { light: "#F5F5F1", dark: "#141414" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isPreference = (value: unknown): value is ThemePreference => value === "system" || value === "light" || value === "dark";

// Storage can be blocked, so a failure means the default (follow the system).
function readPreference(): ThemePreference {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		return isPreference(saved) ? saved : "system";
	} catch {
		return "system";
	}
}

let preference: ThemePreference = typeof window === "undefined" ? "system" : readPreference();
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
	listeners.add(listener);
	const media = window.matchMedia?.(DARK_QUERY);
	// Another tab changed the choice, or the system switched between light and dark.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== THEME_KEY) return;
		preference = isPreference(event.newValue) ? event.newValue : "system";
		emit();
	};
	window.addEventListener("storage", onStorage);
	media?.addEventListener("change", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
		media?.removeEventListener("change", listener);
	};
}

const systemDark = () => window.matchMedia?.(DARK_QUERY).matches ?? false;

export function resolveTheme(choice: ThemePreference, prefersDark: boolean): Theme {
	if (choice === "system") return prefersDark ? "dark" : "light";
	return choice;
}

export function setThemePreference(next: ThemePreference) {
	preference = next;
	try {
		localStorage.setItem(THEME_KEY, next);
	} catch {
		// Not saved; it still applies for this visit.
	}
	emit();
}

// The saved choice, what it resolves to now, and the way to change it. Every caller stays in step.
export function useTheme(): { preference: ThemePreference; theme: Theme; setPreference: (next: ThemePreference) => void } {
	const current = useSyncExternalStore(subscribe, () => preference, () => "system" as const);
	const prefersDark = useSyncExternalStore(subscribe, systemDark, () => false);
	return { preference: current, theme: resolveTheme(current, prefersDark), setPreference: setThemePreference };
}

// Puts the dashboard's theme on <html> while the calling component is mounted and takes it off when it unmounts,
// so leaving the dashboard for the landing page or sign-out goes back to light.
export function useDashboardTheme() {
	const { theme } = useTheme();
	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		root.style.colorScheme = theme;
		document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
	}, [theme]);
	useEffect(
		() => () => {
			const root = document.documentElement;
			root.classList.remove("dark");
			root.style.colorScheme = "";
			document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR.light);
		},
		[],
	);
}
