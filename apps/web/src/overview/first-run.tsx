import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { EmptyState } from "../ui/empty-state.tsx";

const STEPS = [
	{ title: "Post a job", body: "Say what they'll do and what they need. Save it as a draft or open it straight away." },
	{ title: "Share the apply link", body: "Candidates apply on the job's own page. Already have CVs? Upload them to the job." },
	{ title: "Review the ranked list", body: "Every CV is scored against the job, with the evidence beside it. Shortlist the best." },
];

// A company without a single job sees this instead of empty charts: what LucidHire does with a job, the one button
// that starts it, and the three steps to a first shortlist on the step rail (design system §4), on step one.
export function FirstRun() {
	return (
		<div className="@container mt-8">
			<section aria-label="Get started" className="overflow-hidden rounded-xl bg-sheet shadow-card">
				<EmptyState
					swipe
					illustration={<SampleSheet />}
					title="Post your first job"
					actions={
						<Link to="/dashboard/jobs/new" className="btn">
							<Plus size={20} aria-hidden="true" />
							Post a job
						</Link>
					}
				>
					Every CV that comes in is read and ranked against it, so you start with the best ones.
				</EmptyState>
				<ol className="grid gap-x-6 gap-y-6 border-t border-line-2 px-6 pt-6 pb-7 @min-[720px]:grid-cols-3 @max-[560px]:px-4">
					{STEPS.map((step, index) => (
						<li
							key={step.title}
							aria-current={index === 0 ? "step" : undefined}
							className={`border-t-4 pt-3 ${index === 0 ? "border-ink" : "border-line"}`}
						>
							<p className="font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">Step {index + 1}</p>
							<p className="mt-1 text-[16px] leading-[1.3] font-[650]">
								{index === 0 ? <span className="mk">{step.title}</span> : step.title}
							</p>
							<p className="mt-1.5 text-[15px] leading-[1.5] text-ink-2">{step.body}</p>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}

// A small CV sheet with one line marked, as the product marks a matching line. Decoration only.
function SampleSheet() {
	return (
		<div className="w-[148px] -rotate-2 rounded-[3px] bg-sheet p-3.5 shadow-sheet">
			<span className="block h-2 w-3/5 rounded-[2px] bg-ink" />
			<span className="mt-3 block h-1.5 w-full rounded-[2px] bg-line" />
			<span className="mt-1.5 block h-1.5 w-11/12 rounded-[2px] bg-marker" />
			<span className="mt-1.5 block h-1.5 w-4/5 rounded-[2px] bg-line" />
			<span className="mt-1.5 block h-1.5 w-2/3 rounded-[2px] bg-line" />
		</div>
	);
}
