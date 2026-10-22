// Where to send someone after onboarding: the dashboard page they first asked for. It comes from the address bar,
// so only plain paths inside the dashboard count; anything else (another site, another app page, a query) is dropped.
export function safeReturnPath(value: unknown): string | undefined {
	if (typeof value !== "string" || !/^\/dashboard(?:\/(?!\.)[\w.~%-]+)+$/.test(value)) return undefined;
	return value;
}
