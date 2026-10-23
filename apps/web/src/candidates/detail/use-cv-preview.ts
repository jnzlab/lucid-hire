import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiGetBlob } from "../../lib/api.ts";
import { useSession } from "../../lib/session.ts";

export type CvPreview =
	| { state: "idle" }
	| { state: "loading" }
	| { state: "ready"; url: string }
	| { state: "failed" };

type Loaded = { key: string; preview: CvPreview };
const NOTHING: Loaded = { key: "", preview: { state: "idle" } };

// The CV's PDF for the page to show in an <iframe>. The API needs the session token, so the file is fetched the way
// Open CV fetches it and handed over as a temporary object URL. Nothing is fetched until `enabled`; the URL is revoked
// as soon as the candidate changes or the page goes, and a fetch still on its way is cancelled.
export function useCvPreview(jobId: string, id: string, enabled: boolean) {
	const { token } = useSession();
	// The token getter is a new function on every render; the fetch only needs the latest one.
	const getToken = useRef(token);
	useLayoutEffect(() => {
		getToken.current = token;
	});
	const [attempt, setAttempt] = useState(0);
	// What the held result belongs to: a new candidate, or another try, makes it stale (so it reads as loading).
	const key = `${jobId}/${id}#${attempt}`;
	const [loaded, setLoaded] = useState<Loaded>(NOTHING);

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		let url: string | null = null;
		void (async () => {
			try {
				const blob = await apiGetBlob(`/jobs/${jobId}/candidates/${id}/cv`, {
					token: await getToken.current(),
					signal: controller.signal,
				});
				if (controller.signal.aborted) return;
				// The browser only opens its PDF viewer for a PDF, whatever the server called it.
				url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
				setLoaded({ key, preview: { state: "ready", url } });
			} catch {
				if (!controller.signal.aborted) setLoaded({ key, preview: { state: "failed" } });
			}
		})();
		return () => {
			controller.abort();
			if (!url) return;
			URL.revokeObjectURL(url);
			// A revoked URL is never shown, even for the moment before the next fetch is back.
			setLoaded(NOTHING);
		};
	}, [jobId, id, key, enabled]);

	// Until the fetch for this candidate (or this try) is back, it is loading; what is held may be the last one's.
	const preview: CvPreview = !enabled
		? { state: "idle" }
		: loaded.key === key && loaded.preview.state !== "idle"
			? loaded.preview
			: { state: "loading" };
	return { preview, retry: () => setAttempt((count) => count + 1) };
}
