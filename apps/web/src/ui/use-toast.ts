import { type ReactNode, createContext, use } from "react";

export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = {
	// Mono 13.5px. Mark the key word of an error with <span className="mk mk-gap">…</span>.
	message: ReactNode;
	// `error` starts the toast with ✕.
	tone?: "default" | "error";
	// One button after the message, such as Undo. Choosing it also dismisses the toast.
	action?: ToastAction;
	// Milliseconds on screen while not hovered or focused. Defaults to 5000; Infinity keeps it until dismissed.
	duration?: number;
};
export type Toast = ToastOptions & { id: string };
export type ToastApi = {
	// Shows a toast and returns its id. A string or element is shorthand for `{ message }`.
	show: (toast: ToastOptions | string) => string;
	error: (message: ReactNode, options?: Omit<ToastOptions, "message" | "tone">) => string;
	dismiss: (id: string) => void;
};

export const TOAST_DURATION_MS = 5000;
// A toast with Undo stays longer: the recruiter may only notice the slip after moving on to the next candidate.
export const TOAST_ACTION_DURATION_MS = 8000;
export const TOAST_MAX = 3;

const NOOP: ToastApi = { show: () => "", error: () => "", dismiss: () => {} };
export const ToastContext = createContext<ToastApi | null>(null);

// The dashboard's toasts (ToastProvider in ui/toast.tsx is mounted by the dashboard layout):
//   const toast = useToast();
//   toast.show({ message: "Shortlisted Grace Turner", action: { label: "Undo", onClick: undo } });
//   toast.error(<>Couldn't <span className="mk mk-gap">save</span> the note. Try again.</>);
// Outside the dashboard there's no provider, and it does nothing.
export function useToast(): ToastApi {
	return use(ToastContext) ?? NOOP;
}
