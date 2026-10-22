import { API_URL } from "./config.ts";

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

type ApiRequestOptions = {
	token?: string | null;
	signal?: AbortSignal;
};

// GETs a JSON endpoint on the API Worker, sending the Clerk session token when there is one.
export async function apiGet<T>(path: string, { token, signal }: ApiRequestOptions = {}): Promise<T> {
	const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
	const res = await fetch(`${API_URL}${path}`, { headers, signal });
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		throw new ApiError(res.status, body?.error?.message ?? `Request failed with ${res.status}`);
	}
	return (await res.json()) as T;
}
