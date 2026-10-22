// Leaves the app for another site, such as Polar's checkout. A function of its own so tests can replace it.
export function redirectTo(url: string) {
	window.location.assign(url);
}
