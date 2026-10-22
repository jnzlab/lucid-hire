// Facts about the site that more than one page, the Worker or the page <head> repeat.
export const SITE_NAME = "LucidHire";
export const SITE_ORIGIN = "https://lucidhire.io";
export const SUPPORT_EMAIL = "support@lucidhire.io";
export const PRIVACY_EMAIL = "privacy@lucidhire.io";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
export const PRIVACY_MAILTO = `mailto:${PRIVACY_EMAIL}`;
// The last time the privacy policy and terms changed.
export const LEGAL_UPDATED = "22 October 2026";

// Public pages that belong in the sitemap. Open jobs' public pages are added by whoever builds them.
export const PUBLIC_PATHS = ["/", "/privacy", "/terms"] as const;
