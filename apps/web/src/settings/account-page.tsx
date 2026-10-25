import { UserProfile } from "@clerk/react";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { ACCOUNT_PATH } from "./settings-nav.ts";

// Settings → Account: the person's own profile, email addresses, password, two-step verification and sessions in
// Clerk's panel (in the Highlighter look through the app-wide appearance). Clerk uses path routing under this page, so
// its own tabs get addresses of their own. The theme is in the account menu.
export function AccountPage() {
	useDocumentTitle("Account · LucidHire");
	return (
		<div className="grid gap-6">
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
