import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TOAST_ACTION_DURATION_MS, TOAST_DURATION_MS, TOAST_MAX, type Toast, type ToastApi, ToastContext, type ToastOptions } from "./use-toast.ts";

type Timer = { timeout?: number; remaining: number; started: number };

// Holds the dashboard's toasts and shows them bottom-centre, above the mobile tab bar (spec §2.5). At most three
// stack; each goes after five seconds, but the clock stops while the pointer is over them or focus is in them.
// Escape dismisses the focused one. The list is a polite live region, so each new toast is read out once.
export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timers = useRef(new Map<string, Timer>());
	const paused = useRef({ hover: false, focus: false });
	const counter = useRef(0);
	const regionRef = useRef<HTMLElement>(null);
	// Where focus was before it came into the toasts, so it can go back there when the toast holding it closes.
	const cameFrom = useRef<HTMLElement | null>(null);

	const dismiss = useCallback((id: string) => {
		const timer = timers.current.get(id);
		window.clearTimeout(timer?.timeout);
		timers.current.delete(id);
		setToasts((list) => list.filter((toast) => toast.id !== id));
	}, []);

	const start = useCallback(
		(id: string) => {
			const timer = timers.current.get(id);
			if (!timer || !Number.isFinite(timer.remaining)) return;
			window.clearTimeout(timer.timeout);
			timer.started = Date.now();
			timer.timeout = window.setTimeout(() => dismiss(id), timer.remaining);
		},
		[dismiss],
	);
	const isPaused = () => paused.current.hover || paused.current.focus;

	const pause = useCallback(() => {
		for (const timer of timers.current.values()) {
			if (timer.timeout === undefined) continue;
			window.clearTimeout(timer.timeout);
			timer.timeout = undefined;
			timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
		}
	}, []);
	const resume = useCallback(() => {
		for (const id of timers.current.keys()) start(id);
	}, [start]);

	const show = useCallback(
		(input: ToastOptions | string) => {
			const options = typeof input === "string" ? { message: input } : input;
			const id = `toast-${++counter.current}`;
			timers.current.set(id, {
				remaining: options.duration ?? (options.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS),
				started: Date.now(),
			});
			if (!isPaused()) start(id);
			setToasts((list) => {
				const next = [...list, { ...options, id }];
				// The oldest goes when a fourth arrives.
				for (const dropped of next.slice(0, Math.max(0, next.length - TOAST_MAX))) {
					window.clearTimeout(timers.current.get(dropped.id)?.timeout);
					timers.current.delete(dropped.id);
				}
				return next.slice(-TOAST_MAX);
			});
			return id;
		},
		[start],
	);

	// A dismissed toast may have held focus, and a removed element sends no blur: let the clocks run again.
	useEffect(() => {
		if (!paused.current.focus || regionRef.current?.contains(document.activeElement)) return;
		paused.current.focus = false;
		if (!paused.current.hover) resume();
	}, [toasts, resume]);

	useEffect(() => {
		const all = timers.current;
		return () => {
			for (const timer of all.values()) window.clearTimeout(timer.timeout);
		};
	}, []);

	const api = useMemo<ToastApi>(
		() => ({ show, dismiss, error: (message, options) => show({ ...options, message, tone: "error" }) }),
		[show, dismiss],
	);

	// Undo, Dismiss or Escape closes the toast that holds focus. Focus goes back to where it came from (the row or
	// button the recruiter was on), or to the page's heading, instead of falling to the page's body.
	const close = (id: string) => {
		const hadFocus = regionRef.current?.contains(document.activeElement) ?? false;
		dismiss(id);
		if (!hadFocus) return;
		requestAnimationFrame(() => {
			if (document.activeElement && document.activeElement !== document.body) return;
			const back = cameFrom.current?.isConnected ? cameFrom.current : document.querySelector<HTMLElement>("main h1[tabindex]");
			back?.focus({ preventScroll: true });
		});
	};

	const setPaused = (key: "hover" | "focus", value: boolean) => {
		const was = isPaused();
		paused.current[key] = value;
		if (!was && isPaused()) pause();
		else if (was && !isPaused()) resume();
	};

	return (
		<ToastContext value={api}>
			{children}
			<section
				ref={regionRef}
				aria-label="Notifications"
				className="toast-region layer-toast"
				onPointerEnter={() => setPaused("hover", true)}
				onPointerLeave={() => setPaused("hover", false)}
				onFocus={(event) => {
					const from = event.relatedTarget;
					if (from instanceof HTMLElement && !event.currentTarget.contains(from)) cameFrom.current = from;
					setPaused("focus", true);
				}}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused("focus", false);
				}}
			>
				<ol aria-live="polite" className="flex flex-col items-center gap-2">
					{toasts.map((toast) => (
						<li
							key={toast.id}
							className="toast"
							onKeyDown={(event) => {
								if (event.key !== "Escape") return;
								event.preventDefault();
								event.stopPropagation();
								close(toast.id);
							}}
						>
							<p className="min-w-0 flex-1 py-3 [overflow-wrap:anywhere]">
								{toast.tone === "error" && <span aria-hidden="true">✕ </span>}
								{toast.tone === "error" && <><span className="sr-only">Error:</span>{" "}</>}
								{toast.message}
							</p>
							{toast.action && (
								<button
									type="button"
									className="toast-action"
									onClick={() => {
										toast.action?.onClick();
										close(toast.id);
									}}
								>
									{toast.action.label}
								</button>
							)}
							<button type="button" className="toast-close" onClick={() => close(toast.id)}>
								<X size={16} strokeWidth={2} aria-hidden="true" />
								<span className="sr-only">Dismiss</span>
							</button>
						</li>
					))}
				</ol>
			</section>
		</ToastContext>
	);
}
