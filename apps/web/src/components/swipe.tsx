import { useId } from "react";

// The highlighter swipe (design system §3): a broad pale stroke with chisel-cut ends and pooled ink.
// It goes behind the hero illustration, and in the app behind empty-state and onboarding art only.
export function Swipe({ className }: { className: string }) {
	const id = useId();
	return (
		<svg className={className} viewBox="0 0 640 210" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#FFE878" />
					<stop offset=".16" stopColor="#FFF2AE" />
					<stop offset=".5" stopColor="#FFF6C4" />
					<stop offset=".84" stopColor="#FFF2AE" />
					<stop offset="1" stopColor="#FFE878" />
				</linearGradient>
				<linearGradient id={`${id}-pool`} x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stopColor="#FFDF55" />
					<stop offset=".07" stopColor="#FFDF55" stopOpacity="0" />
					<stop offset=".93" stopColor="#FFDF55" stopOpacity="0" />
					<stop offset="1" stopColor="#FFDF55" />
				</linearGradient>
				<path
					id={`${id}-body`}
					d="M42 18C210 8 412 19 626 5L632 12C628 72 620 132 606 196C420 206 228 197 14 207L8 200C16 140 28 80 42 18Z"
				/>
			</defs>
			<use href={`#${id}-body`} fill={`url(#${id}-ink)`} />
			<use href={`#${id}-body`} fill={`url(#${id}-pool)`} />
			<path
				fill="none"
				stroke="#FFE878"
				strokeWidth="6"
				strokeLinecap="round"
				opacity=".55"
				d="M40 68C222 61 420 70 620 58M28 152C220 145 420 154 610 143"
			/>
		</svg>
	);
}
