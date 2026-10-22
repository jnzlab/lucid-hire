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

// Reads the JSON body of a response, or throws the API's error with its message and code.
async function parse<T>(res: Response): Promise<T> {
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

// Calls a JSON endpoint on the API Worker, sending the Clerk session token when there is one.
async function request<T>(
	method: "GET" | "POST" | "PATCH" | "DELETE",
	path: string,
	body: unknown,
	{ token, signal }: ApiRequestOptions,
): Promise<T> {
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	if (body !== undefined) headers["Content-Type"] = "application/json";

	return parse<T>(
		await fetch(`${API_URL}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		}),
	);
}

export function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("GET", path, undefined, options);
}

// Downloads a file, like a CV's PDF. A refusal is parsed like any other call, so it throws the API's error.
export async function apiGetBlob(path: string, { token, signal }: ApiRequestOptions = {}): Promise<Blob> {
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	const res = await fetch(`${API_URL}${path}`, { method: "GET", headers, signal });
	return res.ok ? res.blob() : parse<never>(res);
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

// Uploads a PDF as the raw request body, so the API can stream it straight into storage. The browser
// sets Content-Length from the file.
export async function apiUploadPdf<T>(path: string, file: File, { token, signal }: ApiRequestOptions = {}): Promise<T> {
	const headers: Record<string, string> = { "Content-Type": "application/pdf" };
	if (token) headers.Authorization = `Bearer ${token}`;
	return parse<T>(await fetch(`${API_URL}${path}`, { method: "POST", headers, body: file, signal }));
}
