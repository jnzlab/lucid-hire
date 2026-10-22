import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";

type Me = { userId: string };

// Proves the glue end to end: the Clerk session token from this app is accepted by the API Worker.
export function SessionCheck() {
	const { getToken, userId } = useAuth();
	const me = useQuery({
		queryKey: ["me", userId],
		queryFn: async ({ signal }) => apiGet<Me>("/me", { token: await getToken(), signal }),
		enabled: Boolean(userId),
		retry: false,
	});

	if (me.isPending) {
		return <p className="font-mono text-[13px] text-ink-muted">Checking your session with the API</p>;
	}
	if (me.isError) {
		return (
			<p role="alert" className="font-mono text-[13px] text-gap-ink">
				✕ The API rejected your session: {me.error.message}
			</p>
		);
	}
	return (
		<p className="font-mono text-[13px] text-ink-muted">
			<span className="mk">Signed in</span> · the API verified your session
		</p>
	);
}
