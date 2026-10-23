import { Skeleton } from "../../ui/skeleton.tsx";

// The editor's shape while the job loads, so nothing jumps when it arrives. The sr-only h1 names the page meanwhile.
export function EditorSkeleton({ label }: { label: string }) {
	return (
		<div>
			<h1 className="sr-only">{label}</h1>
			<Skeleton label={label} className="h-4 w-48" />
			<Skeleton className="mt-4 h-9 w-[min(360px,80%)]" />
			<div className="mt-8 grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_360px] min-[1100px]:gap-8">
				<div className="flex flex-col gap-3 rounded-xl bg-sheet p-5 shadow-card min-[561px]:p-7">
					<Skeleton className="h-3.5 w-20" />
					<Skeleton className="h-12 w-full" />
					<Skeleton className="mt-4 h-3.5 w-24" />
					<Skeleton className="h-[360px] w-full" />
				</div>
				<div className="flex flex-col gap-6">
					<div className="flex flex-col gap-3 rounded-xl bg-sheet p-6 shadow-card">
						<Skeleton className="h-5 w-24" />
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-16 w-full" />
						<Skeleton className="mt-2 h-11 w-full" />
					</div>
					<div className="flex flex-col gap-3 rounded-xl bg-sheet p-6 shadow-card">
						<Skeleton className="h-5 w-28" />
						<Skeleton lines={4} className="h-3.5 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
