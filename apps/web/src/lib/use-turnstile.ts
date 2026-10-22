import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "./config.ts";

type TurnstileApi = {
	render: (container: HTMLElement, options: Record<string, unknown>) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId?: string) => void;
};

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

// `loading` until the widget is drawn, `ready` once it is, `unavailable` when Cloudflare's script never arrived
// (blocked, offline) and `failed` when Cloudflare refused this browser, so the page can say why the button stays
// disabled.
export type TurnstileStatus = "loading" | "ready" | "unavailable" | "failed";

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_TIMEOUT_MS = 10_000;

// Loads Cloudflare's script once, on the page that needs it, and resolves when `window.turnstile` exists.
function loadScript(): Promise<TurnstileApi> {
	return new Promise((resolve, reject) => {
		if (window.turnstile) return resolve(window.turnstile);
		let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		if (!script) {
			script = document.createElement("script");
			script.id = SCRIPT_ID;
			script.src = SCRIPT_URL;
			script.async = true;
			document.head.appendChild(script);
		}
		script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
		const started = Date.now();
		const timer = window.setInterval(() => {
			if (window.turnstile) {
				window.clearInterval(timer);
				resolve(window.turnstile);
			} else if (Date.now() - started > TURNSTILE_TIMEOUT_MS) {
				window.clearInterval(timer);
				reject(new Error("Turnstile took too long to load"));
			}
		}, 100);
	});
}

// Draws the check into `containerRef` and keeps its token. A token works once, so call `reset` after a submit.
export function useTurnstile(): {
	containerRef: RefObject<HTMLDivElement | null>;
	token: string | null;
	status: TurnstileStatus;
	reset: () => void;
} {
	const containerRef = useRef<HTMLDivElement>(null);
	const widgetId = useRef<string | undefined>(undefined);
	const [token, setToken] = useState<string | null>(null);
	const [status, setStatus] = useState<TurnstileStatus>("loading");

	useEffect(() => {
		let cancelled = false;
		const timeout = window.setTimeout(() => {
			if (!cancelled && !widgetId.current) setStatus("unavailable");
		}, TURNSTILE_TIMEOUT_MS);

		loadScript().then(
			(turnstile) => {
				const container = containerRef.current;
				if (cancelled || !container) return;
				window.clearTimeout(timeout);
				widgetId.current = turnstile.render(container, {
					sitekey: TURNSTILE_SITE_KEY,
					theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
					size: "flexible",
					callback: (value: string) => {
						setToken(value);
						setStatus("ready");
					},
					"expired-callback": () => setToken(null),
					"timeout-callback": () => setToken(null),
					"error-callback": () => {
						setToken(null);
						setStatus("failed");
					},
				});
				setStatus("ready");
			},
			() => {
				if (!cancelled) setStatus("unavailable");
			},
		);

		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
			if (widgetId.current) window.turnstile?.remove(widgetId.current);
			widgetId.current = undefined;
		};
	}, []);

	const reset = useCallback(() => {
		setToken(null);
		if (!widgetId.current) return;
		setStatus("ready");
		window.turnstile?.reset(widgetId.current);
	}, []);

	return { containerRef, token, status, reset };
}
