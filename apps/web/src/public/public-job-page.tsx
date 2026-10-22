import { Link } from "@tanstack/react-router";
import { Logo } from "../components/logo.tsx";
import { Markdown } from "../components/markdown-lazy.tsx";
import { PageError, PageLoading } from "../components/page-state.tsx";
import { ApiError } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { type PublicJob, coverUrl, usePublicJob } from "../lib/public-jobs.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { ApplyForm } from "./apply-form.tsx";

function PublicHeader() {
	return (
		<header className="app-hdr">
			<div className="wrap">
				<Link to="/" aria-label="LucidHire home" className="rounded-[3px]">
					<Logo />
				</Link>
				<Link
					to="/"
					className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-[3px] font-mono text-[13px] text-ink-muted hover:text-ink"
				>
					<span aria-hidden="true">←</span> Back to LucidHire
				</Link>
			</div>
		</header>
	);
}

export function PublicJobPage({ slug }: { slug: string }) {
	const query = usePublicJob(slug);
	useDocumentTitle(query.data ? `${query.data.title} | LucidHire` : "Job | LucidHire");

	if (query.isPending) return <PageLoading label="Loading job" />;
	if (query.isError) {
		const missing = query.error instanceof ApiError && query.error.status === 404;
		return (
			<>
				<PublicHeader />
				<PageError
					compact
					title={missing ? "This job isn't available" : "We couldn't load this job"}
					message={
						missing
							? "It may have been taken down, or the link may have a typo."
							: query.error.message
					}
					action={
						missing ? (
							<Link to="/" className="btn">
								Go to LucidHire
							</Link>
						) : (
							<button type="button" className="btn" onClick={() => void query.refetch()}>
								Try again
							</button>
						)
					}
				/>
			</>
		);
	}

	return <PublicJob job={query.data} />;
}

function PublicJob({ job }: { job: PublicJob }) {
	const open = job.status === "open";
	return (
		<div className="min-h-dvh bg-paper">
			<PublicHeader />
			<main id="main" className="wrap py-[clamp(24px,5vw,56px)]">
				{job.hasCover && (
					<img
						src={coverUrl(job.slug)}
						alt=""
						className="mb-8 h-[clamp(140px,26vw,300px)] w-full rounded-xl object-cover shadow-card"
					/>
				)}
				<div className="grid items-start gap-8 min-[961px]:grid-cols-[minmax(0,1fr)_380px] min-[961px]:gap-12">
					<article aria-label="Job description" className="min-w-0">
						<p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">
							<span
								className={`inline-flex min-h-7 items-center gap-2 rounded-md border border-line bg-sheet px-2.5 text-[12.5px] tracking-normal normal-case ${open ? "text-ink" : "text-ink-muted"}`}
							>
								<i className={`size-2 rounded-full ${open ? "bg-ink" : "bg-ink-faint"}`} aria-hidden="true" />
								{open ? "Open role" : "Closed role"}
							</span>
							<span>{job.company}</span>
							<span>Posted {formatDate(job.createdAt)}</span>
						</p>
						<h1 className="mt-4 font-display text-[clamp(32px,5vw,56px)] leading-[.98] font-[820] tracking-[-0.038em] [overflow-wrap:anywhere] [font-stretch:112%]">
							{job.title}
						</h1>
						<div className="mt-8 rounded-sheet bg-sheet p-[clamp(20px,4vw,40px)] shadow-sheet">
							<Markdown>{job.description}</Markdown>
						</div>
					</article>
					<aside aria-label="Apply" className="min-[961px]:sticky min-[961px]:top-24">
						{open ? (
							<ApplyForm slug={job.slug} />
						) : (
							<div className="rounded-xl bg-sheet p-6 shadow-card">
								<h2 className="text-[21px] leading-[1.15] font-[800] [font-stretch:108%]">
									<span className="mk mk-gap">Applications closed</span>
								</h2>
								<p className="mt-3 text-[15px] text-ink-2">
									{job.company} isn't taking applications for this role any more.
								</p>
								<Link to="/" className="btn ghost mt-4">
									Go to LucidHire
								</Link>
							</div>
						)}
					</aside>
				</div>
			</main>
		</div>
	);
}
