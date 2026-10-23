import { useUser } from "@clerk/react";

export type Account = { name: string | null; email: string | null; imageUrl: string | null };

// The signed-in person's name, email and photo from Clerk, for the account menu. The photo is only theirs when they
// uploaded one; Clerk's generated avatar is off-palette, so initials stand in for it.
export function useAccount(): Account {
	const { user } = useUser();
	if (!user) return { name: null, email: null, imageUrl: null };
	return {
		name: user.fullName || user.firstName || user.username || null,
		email: user.primaryEmailAddress?.emailAddress ?? null,
		imageUrl: user.hasImage ? user.imageUrl : null,
	};
}

// "Grace Turner" → "GT"; an email or nothing falls back to its first letter.
export function initials(name: string | null, email: string | null): string {
	const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
	if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (email?.[0] ?? "?").toUpperCase();
}
