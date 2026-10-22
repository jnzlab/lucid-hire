// One format for dates and numbers across the app, so the same value never reads two ways.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const NUMBER_FORMAT = new Intl.NumberFormat("en-GB");
const ONE_DECIMAL_FORMAT = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatDate(iso: string) {
	return DATE_FORMAT.format(new Date(iso));
}

export function formatNumber(value: number) {
	return NUMBER_FORMAT.format(value);
}

export function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
	return `${ONE_DECIMAL_FORMAT.format(bytes / (1024 * 1024))} MB`;
}

const DAY_MONTH_UTC = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// "22 Oct" for a UTC calendar day ("2026-10-22"), as the overview charts label their days.
export function formatDayMonth(day: string) {
	return DAY_MONTH_UTC.format(new Date(`${day}T00:00:00Z`));
}

// How long ago something happened, as people say it: "Just now", "5 min ago", "3 h ago", "Yesterday", then the date.
export function formatRelative(iso: string, now: number = Date.now()) {
	const then = new Date(iso);
	const minutes = Math.floor((now - then.getTime()) / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes} min ago`;
	if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	return then.toDateString() === yesterday.toDateString() ? "Yesterday" : formatDate(iso);
}
