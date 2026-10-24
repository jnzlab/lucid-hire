import { useEffect, useRef, useState } from "react";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "../lib/use-media-query.ts";

// About as long as a re-rank takes to read; the count eases out, fast first.
const TWEEN_MS = 450;

// A number that counts from what it showed to its new value, so a re-scored CV reads as a change (design system
// §9.5). With reduced motion, or no matchMedia (some browsers, tests), it shows the new value at once. While it
// counts, screen readers get only the final value.
export function TweenedNumber({ value }: { value: number }) {
	const reduce = useMediaQuery(REDUCED_MOTION_QUERY, true) || typeof requestAnimationFrame !== "function";
	const [shown, setShown] = useState(value);
	// What is on screen right now, so a change in the middle of a count carries on from there.
	const current = useRef(value);

	useEffect(() => {
		const start = current.current;
		if (reduce || start === value) {
			current.current = value;
			return;
		}
		const began = performance.now();
		let frame = 0;
		const step = (now: number) => {
			const progress = Math.min((now - began) / TWEEN_MS, 1);
			current.current = Math.round(start + (value - start) * (1 - (1 - progress) ** 3));
			setShown(current.current);
			if (progress < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [value, reduce]);

	if (reduce || shown === value) return <>{value}</>;
	return (
		<>
			<span aria-hidden="true">{shown}</span>
			<span className="sr-only">{value}</span>
		</>
	);
}
