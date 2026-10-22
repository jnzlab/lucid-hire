import type { ReactNode } from "react";

// Glyphs drawn the way the prototype draws them (design system §4: icons).
export function ArrowRight() {
	return (
		<svg className="arr" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M3 9h11M10 4.5 14.5 9 10 13.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function Check() {
	return (
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<path
				d="M2.5 8.5 6 12l7.5-8"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// Nav and menu icons: 20px, stroke 2, drawn in currentColor (design system §4).
function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="flex-none"
		>
			{children}
		</svg>
	);
}

export const IconJobs = () => (
	<Icon>
		<rect x="2.5" y="6" width="15" height="10.5" rx="2" />
		<path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6M2.5 10.5h15" />
	</Icon>
);
export const IconOverview = () => (
	<Icon>
		<path d="M3 17V9M8.5 17V4M14 17v-6M18 17H2" />
	</Icon>
);
export const IconPlus = () => (
	<Icon>
		<path d="M10 4v12M4 10h12" />
	</Icon>
);
export const IconUpload = () => (
	<Icon>
		<path d="M10 13V3.5M6 7l4-4 4 4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
	</Icon>
);
export const IconSettings = () => (
	<Icon>
		<path d="M3 6h8M15 6h2M3 14h2M9 14h8" />
		<circle cx="13" cy="6" r="2" />
		<circle cx="7" cy="14" r="2" />
	</Icon>
);
export const IconMenu = () => (
	<Icon>
		<path d="M3 5.5h14M3 10h14M3 14.5h14" />
	</Icon>
);
export const IconClose = () => (
	<Icon>
		<path d="m4.5 4.5 11 11M15.5 4.5l-11 11" />
	</Icon>
);
export const IconSidebar = ({ collapsed }: { collapsed: boolean }) => (
	<Icon>
		<rect x="2.5" y="3.5" width="15" height="13" rx="2" />
		<path d={collapsed ? "M8 3.5v13M11.5 8l2 2-2 2" : "M8 3.5v13M13.5 8l-2 2 2 2"} />
	</Icon>
);

export const IconMore = () => (
	<Icon>
		<circle cx="4.5" cy="10" r="1.2" fill="currentColor" />
		<circle cx="10" cy="10" r="1.2" fill="currentColor" />
		<circle cx="15.5" cy="10" r="1.2" fill="currentColor" />
	</Icon>
);

// A page with a folded corner and two lines: a recruiter's note is on this CV.
export function NoteMark() {
	return (
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<path
				d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
