import { API_URL } from "./config.ts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string | undefined;
	// Per-field messages for invalid input, keyed by field name.
	readonly fields: Record<string, string>;

	constructor(status: number, message: string, code?: string, fields: Record<string, string> = {}) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.fields = fields;
	}
}

type ApiRequestOptions = {
	token?: string | null;
	signal?: AbortSignal;
};

// Calls a JSON endpoint on the API Worker, sending the Clerk session token when there is one.
async function request<T>(
	method: "GET" | "POST" | "PATCH" | "DELETE",
	path: string,
	body: unknown,
	{ token, signal }: ApiRequestOptions,
): Promise<T> {
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	if (body !== undefined) headers["Content-Type"] = "application/json";

	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	if (!res.ok) {
		const error = (await res.json().catch(() => null)) as {
			error?: { code?: string; message?: string; fields?: Record<string, string> };
		} | null;
		throw new ApiError(
			res.status,
			error?.error?.message ?? `Request failed with ${res.status}`,
			error?.error?.code,
			error?.error?.fields,
		);
	}
	// 204 No Content (a delete) has no body to parse.
	return (res.status === 204 ? undefined : await res.json()) as T;
}

export function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("GET", path, undefined, options);
}

export function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("POST", path, body, options);
}

export function apiPatch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("PATCH", path, body, options);
}

export function apiDelete(path: string, options: ApiRequestOptions = {}): Promise<void> {
	return request<void>("DELETE", path, undefined, options);
}
