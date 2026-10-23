import { type Account, initials } from "./use-account.ts";

// The person's photo in a circle, or their initials on paper when they haven't uploaded one (design system §2.4:
// round shapes are for avatars).
export function Avatar({ account, size = 32 }: { account: Account; size?: number }) {
	const style = { width: size, height: size };
	if (account.imageUrl) {
		return <img src={account.imageUrl} alt="" style={style} className="flex-none rounded-full border border-line object-cover" />;
	}
	return (
		<span
			aria-hidden="true"
			style={style}
			className="grid flex-none place-items-center rounded-full border border-line bg-sheet font-mono text-[12px] leading-none text-ink-2"
		>
			{initials(account.name, account.email)}
		</span>
	);
}
