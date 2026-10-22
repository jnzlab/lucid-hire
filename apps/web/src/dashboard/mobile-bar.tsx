import { Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { IconClose, IconMenu } from "../components/icons.tsx";
import { Logo } from "../components/logo.tsx";
import type { Org } from "../lib/me.ts";
import { AccountButton } from "./account-button.tsx";
import { NavLinks } from "./nav-links.tsx";
import { PlanBadge } from "./plan-badge.tsx";
import { pageTitle } from "./nav.tsx";

// Below 768px: a top bar with the menu button and a breadcrumb, and the sidebar as a sheet that slides in.
export function MobileBar({ org, pathname }: { org: Org; pathname: string }) {
	const [open, setOpen] = useState(false);
	const title = pageTitle(pathname);

	return (
		<div className="sticky top-0 z-60 border-b border-line bg-paper md:hidden">
			<div className="flex h-14 items-center gap-2 px-[max(12px,env(safe-area-inset-left,0px))]">
				<button
					type="button"
					onClick={() => setOpen(true)}
					aria-haspopup="dialog"
					aria-expanded={open}
					className="inline-grid size-11 place-items-center rounded-md hover:bg-line-2"
				>
					<IconMenu />
					<span className="sr-only">Open menu</span>
				</button>
				<nav aria-label="Breadcrumb" className="min-w-0 flex-1">
					<ol className="flex items-center gap-2 font-mono text-[13px] text-ink-muted">
						<li>
							<Link to="/dashboard" className="rounded-[3px] hover:text-ink">
								Dashboard
							</Link>
						</li>
						<li aria-hidden="true">/</li>
						<li aria-current="page" className="truncate text-ink">
							{title}
						</li>
					</ol>
				</nav>
				<AccountButton />
			</div>
			{open && <Sheet org={org} pathname={pathname} onClose={() => setOpen(false)} />}
		</div>
	);
}

const FOCUSABLE = "a[href], button:not([disabled])";

// A modal sheet: focus moves in, Tab stays inside, Escape or a tap outside closes it and focus goes back to
// the menu button.
function Sheet({ org, pathname, onClose }: { org: Org; pathname: string; onClose: () => void }) {
	const headingId = useId();
	const sheetRef = useRef<HTMLDivElement>(null);
	const onKey = useEffectEvent((event: KeyboardEvent) => {
		if (event.key === "Escape") onClose();
		if (event.key !== "Tab" || !sheetRef.current) return;
		const items = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) return;
		const inside = sheetRef.current.contains(document.activeElement);
		if (!inside || (event.shiftKey && document.activeElement === first)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});

	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		const listener = (event: KeyboardEvent) => onKey(event);
		document.addEventListener("keydown", listener);
		return () => {
			document.removeEventListener("keydown", listener);
			opener?.focus();
		};
	}, []);

	return (
		<div className="fixed inset-0 z-[80]">
			<div className="absolute inset-0 bg-[rgba(20,20,20,.5)]" onClick={onClose} aria-hidden="true" />
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col gap-5 overflow-y-auto bg-paper-2 p-4 shadow-float"
			>
				<h2 id={headingId} className="sr-only">
					Menu
				</h2>
				<div className="flex items-center justify-between">
					<Link to="/dashboard" aria-label="LucidHire dashboard" onClick={onClose} className="rounded-[3px]">
						<Logo />
					</Link>
					<button type="button" onClick={onClose} className="inline-grid size-11 place-items-center rounded-md hover:bg-line-2">
						<IconClose />
						<span className="sr-only">Close menu</span>
					</button>
				</div>
				<div className="flex items-center justify-between gap-2 border-t border-line pt-4">
					<p className="truncate font-mono text-[13px] text-ink-2">{org.name}</p>
					<PlanBadge onNavigate={onClose} />
				</div>
				<NavLinks pathname={pathname} onNavigate={onClose} />
				<p className="mt-auto border-t border-line pt-4 font-mono text-[12px] text-ink-muted">
					Your role: {org.role === "admin" ? "Admin" : "Member"}
				</p>
			</div>
		</div>
	);
}
