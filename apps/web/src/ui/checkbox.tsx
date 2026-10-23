import { type ComponentProps, type ReactNode, type Ref, useEffect, useRef } from "react";

// A real checkbox drawn as an 18px box with a 1.5px ink border; checked fills it with marker and draws the check,
// indeterminate draws a dash (design system §9). The label around it makes the whole 44px area clickable. Use
// `hideLabel` in tables, where the row names it ("Select Grace Turner").
export function Checkbox({
	checked,
	indeterminate = false,
	onCheckedChange,
	label,
	hideLabel = false,
	className = "",
	ref: outerRef,
	...props
}: Omit<ComponentProps<"input">, "type" | "checked" | "onChange"> & {
	checked: boolean;
	indeterminate?: boolean;
	onCheckedChange: (checked: boolean) => void;
	label: ReactNode;
	hideLabel?: boolean;
}) {
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);
	// A caller's ref gets the input too, without taking over the one `indeterminate` needs.
	const setRef = (input: HTMLInputElement | null) => {
		ref.current = input;
		assignRef(outerRef, input);
	};

	return (
		<label className={`checkbox ${hideLabel ? "is-bare" : ""} ${props.disabled ? "is-disabled" : ""} ${className}`}>
			<input
				ref={setRef}
				type="checkbox"
				checked={checked}
				onChange={(event) => onCheckedChange(event.currentTarget.checked)}
				className="peer sr-only"
				{...props}
			/>
			<span className="checkbox-box" aria-hidden="true">
				{indeterminate ? (
					<svg viewBox="0 0 16 16" width="14" height="14">
						<path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
					</svg>
				) : (
					<svg viewBox="0 0 16 16" width="14" height="14" className="checkbox-check">
						<path
							d="M2.5 8.5 6 12l7.5-8"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				)}
			</span>
			<span className={hideLabel ? "sr-only" : "text-[15px] text-ink"}>{label}</span>
		</label>
	);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref) ref.current = value;
}
