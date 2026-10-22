import { createClerkClient } from "@clerk/backend";

export type DirectoryUser = { name: string | null; email: string | null; imageUrl: string | null };

// Names, emails and pictures live in Clerk, not in our database. One batched call looks up every user asked for.
export type UserDirectory = (env: Env, userIds: string[]) => Promise<Map<string, DirectoryUser>>;

const BATCH = 100;

export const clerkDirectory: UserDirectory = async (env, userIds) => {
	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
	const users = new Map<string, DirectoryUser>();
	for (let i = 0; i < userIds.length; i += BATCH) {
		const { data } = await clerk.users.getUserList({ userId: userIds.slice(i, i + BATCH), limit: BATCH });
		for (const user of data) {
			const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
			users.set(user.id, {
				name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
				email: email?.emailAddress ?? null,
				imageUrl: user.hasImage ? user.imageUrl : null,
			});
		}
	}
	return users;
};
