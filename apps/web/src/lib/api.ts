import { API_URL } from "./config.ts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string | undefined;
	// Per-field messages for invalid input, keyed by field name.
	readonly fields: Record<string, string>;
	// Set on plan-limit errors: where to upgrade.
	readonly upgradeUrl: string | undefined;

	constructor(
		status: number,
		message: string,
		code?: string,
		fields: Record<string, string> = {},
		upgradeUrl?: string,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.fields = fields;
		this.upgradeUrl = upgradeUrl;
	}
}

// What the recruiter reads when a call fails without the API saying why.
export const NETWORK_ERROR_MESSAGE = "We couldn't reach LucidHire. Check your connection and try again.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Try again.";
const UNKNOWN_ERROR_MESSAGE = "Something went wrong. Try again.";

type ApiRequestOptions = {
	token?: string | null;
	signal?: AbortSignal;
};

// fetch, with a failed connection turned into an ApiError in plain words. A call the page cancelled keeps
// its own error, which the caller expects.
async function send(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
		throw new ApiError(0, NETWORK_ERROR_MESSAGE, "network_error");
	}
}

// The error the API sent as `{ error: { code, message, fields } }`, or a plain one when it said nothing.
function toApiError(status: number, body: unknown): ApiError {
	const error = (
		body as { error?: { code?: string; message?: string; fields?: Record<string, string>; upgradeUrl?: string } } | null
	)?.error;
	return new ApiError(
		status,
		error?.message || (status >= 500 ? SERVER_ERROR_MESSAGE : UNKNOWN_ERROR_MESSAGE),
		error?.code,
		error?.fields,
		error?.upgradeUrl,
	);
}

// Reads the JSON body of a response, or throws the API's error with its message and code.
async function parse<T>(res: Response): Promise<T> {
	if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
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
		await send(`${API_URL}${path}`, {
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
	const res = await send(`${API_URL}${path}`, { method: "GET", headers, signal });
	return res.ok ? res.blob() : parse<never>(res);
}

// A file name from a Content-Disposition header, if it has a plain one.
const fileNameOf = (header: string | null) => header?.match(/filename="([^"]+)"/i)?.[1] ?? null;

// Downloads a generated file, like the CSV export, with the name the API gave it.
export async function apiGetFile(
	path: string,
	{ token, signal }: ApiRequestOptions = {},
): Promise<{ blob: Blob; fileName: string | null }> {
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	const res = await send(`${API_URL}${path}`, { method: "GET", headers, signal });
	return res.ok
		? { blob: await res.blob(), fileName: fileNameOf(res.headers.get("Content-Disposition")) }
		: parse<never>(res);
}

export function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("POST", path, body, options);
}

export function apiPatch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("PATCH", path, body, options);
}

// A DELETE whose answer has a body, such as the job without its cover.
export function apiDeleteJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	return request<T>("DELETE", path, undefined, options);
}

export function apiDelete(path: string, options: ApiRequestOptions = {}): Promise<void> {
	return request<void>("DELETE", path, undefined, options);
}

// Uploads a PDF as the raw request body, so the API can stream it straight into storage. The browser sets
// Content-Length from the file. It goes through XMLHttpRequest because fetch cannot report how much of an upload has
// been sent: `onProgress` gets 0 to 100 as the bytes leave.
export function apiUploadPdf<T>(
	path: string,
	file: File,
	{ token, signal, onProgress }: ApiRequestOptions & { onProgress?: (percent: number) => void } = {},
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${API_URL}${path}`);
		xhr.setRequestHeader("Content-Type", "application/pdf");
		if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress?.(Math.round((100 * event.loaded) / event.total));
		};
		xhr.onload = () => {
			let body: unknown = null;
			try {
				body = JSON.parse(xhr.responseText);
			} catch {
				// Not JSON: a proxy's error page, say. The status still says what happened.
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
			else reject(toApiError(xhr.status, body));
		};
		xhr.onerror = () => reject(new ApiError(0, NETWORK_ERROR_MESSAGE, "network_error"));
		xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
		signal?.addEventListener("abort", () => xhr.abort(), { once: true });
		xhr.send(file);
	});
}

// Sends an application: the PDF is the raw body (so the API can stream it into storage) and everything else rides in
// headers. No session: applicants don't have an account.
export async function apiApply(
	path: string,
	file: File,
	{ email, captchaToken }: { email: string; captchaToken: string },
	{ signal }: ApiRequestOptions = {},
): Promise<{ ok: true }> {
	const headers = {
		"Content-Type": "application/pdf",
		"X-Applicant-Email": email,
		"X-Turnstile-Token": captchaToken,
		"X-File-Name": encodeURIComponent(file.name),
	};
	return parse(await send(`${API_URL}${path}`, { method: "POST", headers, body: file, signal }));
}

// Sends an image (or any file) as the raw body of a PUT, with the file's own type.
export async function apiPutFile<T>(path: string, file: File, { token, signal }: ApiRequestOptions = {}): Promise<T> {
	const headers: Record<string, string> = { "Content-Type": file.type };
	if (token) headers.Authorization = `Bearer ${token}`;
	return parse<T>(await send(`${API_URL}${path}`, { method: "PUT", headers, body: file, signal }));
}
