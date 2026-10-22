import { UserProfile } from "@clerk/react";

// Profile, email addresses, password, two-step verification and sessions: Clerk's own panel, in the Highlighter look
// through the app-wide appearance. It uses path routing under /dashboard/settings, so its tabs never touch the #plan and
// #team anchors (hash routing would read them as profile pages).
export function AccountSection() {
	return (
		<section id="account" aria-labelledby="account-h">
			<h2 id="account-h" className="text-[22px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]">
				Account
			</h2>
			<div className="mt-5 [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-cardBox]:max-w-full">
				<UserProfile routing="path" path="/dashboard/settings" />
			</div>
		</section>
	);
}
