import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";

type Health = { ok: boolean; service: string };

// Live status pill for the API Worker, as the design system's status pill (§4).
export function ApiStatus() {
	const health = useQuery({
		queryKey: ["health"],
		queryFn: ({ signal }) => apiGet<Health>("/health", { signal }),
		retry: 1,
	});

	const label = health.isPending
		? "Checking the API"
		: health.data?.ok
			? "API online · lucidhire-api"
			: "API unreachable";

	return (
		<p
			role="status"
			aria-live="polite"
			className="inline-flex min-h-11 items-center gap-2.5 rounded-md bg-sheet px-3.5 font-mono text-[13.5px] text-ink shadow-card"
		>
			<span className={health.isPending || health.data?.ok ? "live-dot" : "live-dot is-off"} aria-hidden="true" />
			{label}
		</p>
	);
}
