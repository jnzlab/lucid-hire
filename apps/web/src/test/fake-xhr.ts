import { vi } from "vitest";

export type FakeXhrRequest = { method: string; url: string; headers: Record<string, string>; body: File };
// Reports progress as `loaded` bytes of the body's `total`.
type Progress = (loaded: number, total: number) => void;
// Answers a request: a status and a body, or throws for a connection that failed.
type Handler = (request: FakeXhrRequest, progress: Progress) => Promise<{ status: number; body: string }>;

// jsdom's XMLHttpRequest would go to the network. This one hands each upload to `handler`, and reports progress and
// the answer the way the real one does.
export function stubXhr(handler: Handler) {
	class FakeXhr {
		upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
			onprogress: null,
		};
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		onabort: (() => void) | null = null;
		status = 0;
		responseText = "";
		private method = "";
		private url = "";
		private headers: Record<string, string> = {};

		open(method: string, url: string) {
			this.method = method;
			this.url = url;
		}
		setRequestHeader(name: string, value: string) {
			this.headers[name] = value;
		}
		send(body: File) {
			const progress: Progress = (loaded, total) => this.upload.onprogress?.({ lengthComputable: true, loaded, total });
			handler({ method: this.method, url: this.url, headers: this.headers, body }, progress).then(
				(answer) => {
					this.status = answer.status;
					this.responseText = answer.body;
					this.onload?.();
				},
				() => this.onerror?.(),
			);
		}
		abort() {
			this.onabort?.();
		}
	}
	vi.stubGlobal("XMLHttpRequest", FakeXhr);
}
