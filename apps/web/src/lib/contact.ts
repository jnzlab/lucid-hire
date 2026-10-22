// Links built from a candidate's contact details. The details come from a CV, so every value is encoded and
// only web links are ever made clickable.

// "https://www.github.com/ada/" as "github.com/ada": the host and the path, without the scheme or tracking query.
export function linkText(url: string): string {
	try {
		const { host, pathname } = new URL(url);
		const path = pathname.replace(/\/+$/, "");
		return `${host.replace(/^www\./, "")}${path}`;
	} catch {
		return url;
	}
}

// Only http and https can be clicked: a CV could hold javascript: or data: in a link.
export function isWebLink(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

// "+44 (0)20 7946 0958" as "tel:+4402079460958": the digits a phone can dial.
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "";

// A Gmail compose window to the candidate, in a new tab. The app sends nothing itself.
export function gmailComposeUrl(args: {
	to: string;
	candidateName: string | null;
	jobTitle: string;
	companyName: string;
}): string {
	const first = firstName(args.candidateName);
	const body = [
		first ? `Hi ${first},` : "Hello,",
		"",
		`Thank you for applying for the ${args.jobTitle} role at ${args.companyName}. We'd like to talk to you about the next steps.`,
		"",
		"When are you free for a short call this week?",
		"",
		"Best,",
		args.companyName,
	].join("\n");
	const query = new URLSearchParams({
		view: "cm",
		fs: "1",
		to: args.to,
		su: `Next steps — ${args.jobTitle}`,
		body,
	});
	// URLSearchParams writes spaces as "+", which Gmail shows literally.
	return `https://mail.google.com/mail/?${query.toString().replace(/\+/g, "%20")}`;
}
