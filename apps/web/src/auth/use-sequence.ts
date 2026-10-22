import { useEffect, useState } from "react";

// Plays a short scripted moment once: the step starts at 0 and moves to i + 1 at delays[i] ms after mount.
// With reduced motion (or no matchMedia, as in tests) it starts on the last step, so the scene is complete at rest.
export function useSequence(delays: readonly number[]): number {
	const [step, setStep] = useState(() => (reducedMotion() ? delays.length : 0));

	useEffect(() => {
		if (reducedMotion()) return;
		const timers = delays.map((ms, index) => setTimeout(() => setStep(index + 1), ms));
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, [delays]);

	return step;
}

function reducedMotion(): boolean {
	return typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}
