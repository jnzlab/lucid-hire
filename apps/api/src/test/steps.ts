import type { WorkflowStep } from "cloudflare:workers";

// Workflows tries a step without its own retries this many more times.
const DEFAULT_RETRIES = 5;

// The engine's NonRetryableError, as the runs receive it from the Workflow class.
export const nonRetryable = (message: string) => Object.assign(new Error(message), { name: "NonRetryableError" });

// A stand-in for a Workflow's `step` that runs each step at once and records its name, once per attempt. A step that
// throws is tried again up to its retry limit, as the engine does, unless it threw a NonRetryableError. A sleep
// returns at once after `onSleep`, so a test can change the world while a run waits.
export function fakeStep({ onSleep }: { onSleep?: (name: string) => Promise<void> | void } = {}) {
	const names: string[] = [];
	const step = {
		async do(name: string, configOrCallback: unknown, maybeCallback?: unknown) {
			const configured = typeof configOrCallback !== "function";
			const callback = (configured ? maybeCallback : configOrCallback) as () => Promise<unknown>;
			const config = configured ? (configOrCallback as { retries?: { limit: number } }) : undefined;
			const attempts = (config?.retries?.limit ?? DEFAULT_RETRIES) + 1;
			let failure: unknown;
			for (let attempt = 0; attempt < attempts; attempt++) {
				names.push(name);
				try {
					return await callback();
				} catch (error) {
					failure = error;
					if (error instanceof Error && error.name === "NonRetryableError") break;
				}
			}
			throw failure;
		},
		async sleep(name: string) {
			names.push(name);
			await onSleep?.(name);
		},
	};
	return { step: step as unknown as WorkflowStep, names };
}
