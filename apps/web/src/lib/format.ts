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
