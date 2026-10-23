import { Link } from "@tanstack/react-router";
import { IconPlus, IconUpload } from "../components/icons.tsx";
import { useUploadTarget } from "../lib/jobs.ts";
import { NAV_ITEMS, navCurrent } from "./nav.tsx";

// Rows in the sidebar and in the mobile sheet. Collapsed, the label is kept for screen readers and a tooltip.
const row = (collapsed: boolean) =>
	`flex min-h-11 items-center gap-3 rounded-md text-[15px] font-[500] text-ink-2 hover:bg-line-2 hover:text-ink ${collapsed ? "justify-center px-0" : "px-3"}`;

function Label({ collapsed, children }: { collapsed: boolean; children: string }) {
	return <span className={collapsed ? "sr-only" : "truncate"}>{children}</span>;
}

// The pages, then the two shortcuts. `onNavigate` closes the mobile sheet.
export function NavLinks({
	pathname,
	collapsed = false,
	onNavigate,
}: {
	pathname: string;
	collapsed?: boolean;
	onNavigate?: () => void;
}) {
	const { jobId } = useUploadTarget();

	return (
		<nav aria-label="Main" className="flex flex-col gap-5">
			<ul className="flex flex-col gap-1">
				{NAV_ITEMS.map((item) => {
					const current = navCurrent(item, pathname);
					return (
						<li key={item.to}>
							<Link
								to={item.to}
								// Exact, or Link would mark Overview as the page for every page under /dashboard.
								activeOptions={{ exact: true }}
								aria-current={current}
								title={collapsed ? item.label : undefined}
								onClick={onNavigate}
								className={`${row(collapsed)} ${current ? "bg-marker font-[650] text-on-marker hover:bg-marker hover:text-on-marker" : ""}`}
							>
								{item.icon}
								<Label collapsed={collapsed}>{item.label}</Label>
							</Link>
						</li>
					);
				})}
			</ul>
			<div className="flex flex-col gap-1 border-t border-line pt-4">
				{!collapsed && (
					<p className="px-3 pb-1 font-mono text-[11px] tracking-[.08em] text-ink-muted uppercase">Shortcuts</p>
				)}
				<Link
					to="/dashboard/jobs/new"
					title={collapsed ? "Post a job" : undefined}
					onClick={onNavigate}
					className={row(collapsed)}
				>
					<IconPlus />
					<Label collapsed={collapsed}>Post a job</Label>
				</Link>
				{jobId ? (
					<Link
						to="/dashboard/jobs/$jobId"
						params={{ jobId }}
						hash="upload"
						title={collapsed ? "Upload CVs" : undefined}
						onClick={onNavigate}
						className={row(collapsed)}
					>
						<IconUpload />
						<Label collapsed={collapsed}>Upload CVs</Label>
					</Link>
				) : (
					<Link
						to="/dashboard/jobs/new"
						title={collapsed ? "Upload CVs" : undefined}
						onClick={onNavigate}
						className={row(collapsed)}
					>
						<IconUpload />
						<Label collapsed={collapsed}>Upload CVs</Label>
					</Link>
				)}
			</div>
		</nav>
	);
}
