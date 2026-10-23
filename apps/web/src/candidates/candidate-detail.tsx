import { useNavigate, useSearch } from "@tanstack/react-router";
import { Copy, ExternalLink, Mail, Maximize2, MoreHorizontal, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import {
	type Candidate,
	type CandidateSummary,
	MAX_SCORING_RUNS,
	candidateEmail,
	candidateName,
	failureMessage,
	isEmail,
	isWorking,
	useCandidate,
	useCandidates,
	useDeleteCandidate,
	useOpenCv,
	useRetryCandidate,
} from "../lib/candidates.ts";
import { gmailComposeUrl } from "../lib/contact.ts";
import { formatFileSize } from "../lib/format.ts";
import { useHotkeys } from "../lib/hotkeys.ts";
import { candidatePath } from "../jobs/workspace/view.ts";
import { useJob } from "../lib/jobs.ts";
import { forgetVisit, rememberVisit } from "../lib/recent.ts";
import { HOVER_QUERY, useMediaQuery } from "../lib/use-media-query.ts";
import { AppLink } from "../ui/app-link.tsx";
import { candidatesViewHref } from "../lib/all-candidates.ts";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Tab, TabList, TabPanel, Tabs } from "../ui/tabs.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { useToast } from "../ui/use-toast.ts";
import { DecisionBar, NoteField, NoteToggle } from "./decision-block.tsx";
import { MetaRow, ScoreBlock } from "./detail/candidate-header.tsx";
import { CvPreview, type OpenCv, OpenCvAction } from "./detail/cv-preview.tsx";
import { Evidence } from "./detail/evidence.tsx";
import { type CandidateSearch, type Place, jobHref, placeIn, validateCandidateSearch } from "./detail/job-view.ts";
import { PrevNext } from "./detail/prev-next.tsx";
import { useCvPreview } from "./detail/use-cv-preview.ts";
import { useDecision } from "./detail/use-decision.ts";
import { InterviewQuestions } from "./interview-questions.tsx";
import { ProfileCard } from "./profile-card.tsx";
import { RefreshFailed } from "./refresh-failed.tsx";

type Mode = "panel" | "page";
type DetailTab = "evidence" | "profile" | "cv" | "questions";

// The page gets two columns from here: the body on the left, the decision, note and CV file on the right.
const WIDE_QUERY = "(min-width: 1200px)";
// The page's side gutters (the .wrap padding), so a bar stuck to the top can run from edge to edge.
const PAGE_BLEED = "-mx-[clamp(16px,4vw,56px)] px-[clamp(16px,4vw,56px)]";
const PANEL_BLEED = "-mx-6 px-6";

// The panel's tab last chosen, so moving down the job's list keeps the recruiter on the same part (the CV, say). The
// job page draws a new panel for each candidate, so it lives out here; the page keeps its own while it is open.
let lastPanelTab: DetailTab = "evidence";

// One candidate, read in full: the score and the evidence for it, the decision with its note, the profile from the CV,
// the CV itself and interview questions. `page` is the candidate's own page (breadcrumbs, previous and next, two
// columns on a wide screen); `panel` is the job page's split view (one column with its own scroll, no page chrome).
// After a delete, the page goes back to the job; the panel calls `onDeleted` so the job page can select the next row.
// S, X and U decide, O opens the CV and E writes to the candidate, in both.
export function CandidateDetail({
	jobId,
	candidateId,
	mode,
	onDeleted,
}: {
	jobId: string;
	candidateId: string;
	mode: Mode;
	onDeleted?: (name: string) => void;
}) {
	// The job page's filter, search and sort, from the address (the candidate page carries them over).
	const view = validateCandidateSearch(useSearch({ strict: false }) as Record<string, unknown>);
	const list = useCandidates(jobId);
	const [tab, setTab] = useState<DetailTab>(() => (mode === "panel" ? lastPanelTab : "evidence"));
	const chooseTab = (next: DetailTab) => {
		if (mode === "panel") lastPanelTab = next;
		setTab(next);
	};
	const rows = list.data?.candidates;
	const place = mode === "page" && rows ? placeIn(rows, view, candidateId) : null;

	const detail = (
		<ForCandidate
			key={candidateId}
			jobId={jobId}
			candidateId={candidateId}
			mode={mode}
			view={view}
			place={place}
			row={rows?.find((row) => row.id === candidateId)}
			tab={tab}
			onTab={chooseTab}
			onDeleted={onDeleted}
		/>
	);
	if (mode === "page") return detail;
	return <div className="h-full overflow-y-auto overscroll-contain bg-paper px-6 pb-12">{detail}</div>;
}

type ForCandidateProps = {
	jobId: string;
	candidateId: string;
	mode: Mode;
	view: CandidateSearch;
	place: Place | null;
	// The candidate as the job's list has it, to show while the rest loads.
	row: CandidateSummary | undefined;
	tab: DetailTab;
	onTab: (tab: DetailTab) => void;
	onDeleted?: (name: string) => void;
};

// Everything for one candidate. It is keyed by the candidate, so a delete or a retry never carries over to the next.
function ForCandidate({ jobId, candidateId, mode, view, place, row, tab, onTab, onDeleted }: ForCandidateProps) {
	const job = useJob(jobId);
	const remove = useDeleteCandidate(jobId, candidateId);
	// Once the delete starts nothing asks for the candidate again: after the API deletes it, a poll would get
	// "doesn't exist" before the page has moved on.
	const candidate = useCandidate(jobId, candidateId, !remove.isPending && !remove.isSuccess);
	const name = candidate.data ? candidateName(candidate.data) : null;
	const jobTitle = job.data?.title;
	// A failed refresh keeps what is on screen, unless the API says the candidate is gone.
	const gone = candidate.error instanceof ApiError && candidate.error.status === 404;

	// The page names itself after the candidate; the panel leaves the job page's title alone.
	useEffect(() => {
		if (mode === "page") document.title = `${name ?? "Candidate"} · LucidHire`;
	}, [mode, name]);
	// For the command palette's "Recent".
	useEffect(() => {
		if (name) rememberVisit({ kind: "candidate", id: candidateId, jobId, name, jobTitle });
	}, [candidateId, jobId, name, jobTitle]);

	const chrome = mode === "page" && (
		<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
			<Breadcrumbs
				className="min-w-0 flex-1"
				items={[
					view.from === "candidates"
						? { label: "Candidates", href: candidatesViewHref() }
						: { label: "Jobs", href: "/dashboard/jobs" },
					{ label: jobTitle ?? "Job", href: jobHref(jobId, view) },
					{ label: name ?? row?.name ?? "Candidate" },
				]}
			/>
			{place && <PrevNext jobId={jobId} place={place} view={view} />}
		</div>
	);

	let body: ReactNode = null;
	if (candidate.isPending) body = <DetailLoading mode={mode} row={row} />;
	else if (candidate.isError && (!candidate.data || gone)) {
		body = (
			<DetailError mode={mode} jobId={jobId} view={view} error={candidate.error} onRetry={() => void candidate.refetch()} />
		);
	} else if (candidate.data) {
		body = (
			<DetailBody
				jobId={jobId}
				jobTitle={jobTitle}
				candidate={candidate.data}
				mode={mode}
				view={view}
				remove={remove}
				refreshFailed={candidate.isError}
				onRefresh={() => void candidate.refetch()}
				tab={tab}
				onTab={onTab}
				onDeleted={onDeleted}
			/>
		);
	}
	return (
		<>
			{chrome}
			{body}
		</>
	);
}

// While the candidate loads: what the list already knows (name and headline) over grey bars, so moving to the next
// candidate doesn't blank the pane.
function DetailLoading({ mode, row }: { mode: Mode; row: CandidateSummary | undefined }) {
	const known = row ? candidateName(row) : null;
	return (
		<div className={mode === "page" ? "mt-3" : "pt-6"}>
			{mode === "page" ? (
				<h1 className="sr-only">Loading candidate</h1>
			) : (
				<p role="status" className="sr-only">
					Loading candidate
				</p>
			)}
			<div aria-hidden="true">
				{known ? (
					<p className={mode === "page" ? "page-title" : "text-[26px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:108%]"}>
						{known}
					</p>
				) : (
					<Skeleton className="h-9 w-64 max-w-full" />
				)}
				{row?.headline ? (
					<p className="mt-2 font-mono text-[13.5px] text-ink-2">{row.headline}</p>
				) : (
					<Skeleton className="mt-3 h-4 w-48" />
				)}
				<Skeleton className="mt-8 h-11 w-[22rem] max-w-full" />
				<div className="mt-8 flex flex-col gap-2.5">
					<Skeleton className="h-4 w-full max-w-[62ch]" />
					<Skeleton className="h-4 w-11/12 max-w-[58ch]" />
					<Skeleton className="h-4 w-3/5 max-w-[40ch]" />
				</div>
			</div>
		</div>
	);
}

function DetailError({
	mode,
	jobId,
	view,
	error,
	onRetry,
}: {
	mode: Mode;
	jobId: string;
	view: CandidateSearch;
	error: Error;
	onRetry: () => void;
}) {
	const missing = error instanceof ApiError && error.status === 404;
	// The whole page when it is the page; inside the job page's panel it sits under the job's h1.
	const Heading = mode === "page" ? "h1" : "h2";
	return (
		<div role="alert" className="mt-6 flex max-w-md flex-col items-start gap-4 rounded-xl bg-sheet p-6 shadow-card">
			<Heading className="text-[19px] leading-[1.2] font-[800] tracking-[-0.01em] [font-stretch:108%]">
				<span className="mk mk-gap">✕ {missing ? "This candidate doesn't exist" : "We couldn't load this candidate"}</span>
			</Heading>
			<p className="text-[15px] text-ink-2">
				{missing ? "It may have been deleted, or it belongs to another company." : error.message}
			</p>
			{missing ? (
				mode === "page" && (
					<AppLink href={jobHref(jobId, view)} className="btn">
						Back to the job
					</AppLink>
				)
			) : (
				<button type="button" className="btn" onClick={onRetry}>
					Try again
				</button>
			)}
		</div>
	);
}

// A quiet line in a tab that has nothing to show yet.
function TabNote({ children }: { children: ReactNode }) {
	return <p className="max-w-[56ch] rounded-xl border border-line px-5 py-4 text-[15px] text-ink-2">{children}</p>;
}

function DetailBody({
	jobId,
	jobTitle,
	candidate,
	mode,
	view,
	remove,
	refreshFailed,
	onRefresh,
	tab,
	onTab,
	onDeleted,
}: {
	jobId: string;
	// Undefined until the job has loaded.
	jobTitle: string | undefined;
	candidate: Candidate;
	mode: Mode;
	view: CandidateSearch;
	remove: ReturnType<typeof useDeleteCandidate>;
	refreshFailed: boolean;
	onRefresh: () => void;
	tab: DetailTab;
	onTab: (tab: DetailTab) => void;
	onDeleted?: (name: string) => void;
}) {
	const org = useOrg();
	const toast = useToast();
	const navigate = useNavigate();
	const retry = useRetryCandidate(jobId);
	const decision = useDecision(jobId, candidate);
	const cv: OpenCv = useOpenCv(jobId, candidate.id, candidate.fileName);
	// Keycaps and the PDF inside the page only make sense with a keyboard and a mouse; phones open the PDF instead.
	const desk = useMediaQuery(HOVER_QUERY);
	const wide = useMediaQuery(WIDE_QUERY) && mode === "page";
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	// The CV is fetched the first time its tab opens, and kept while this candidate is open.
	const [cvWanted, setCvWanted] = useState(tab === "cv");
	const cvPreview = useCvPreview(jobId, candidate.id, desk && cvWanted);
	const showTab = (next: DetailTab) => {
		if (next === "cv") setCvWanted(true);
		onTab(next);
	};

	const name = candidateName(candidate);
	const email = candidateEmail(candidate);
	const scored = candidate.status === "scored";
	const working = isWorking(candidate);
	const requirements = candidate.requirements ?? [];
	const isAdmin = org.role === "admin";
	// Section headings sit under the candidate's name: h1 on the page, h2 in the panel.
	const level = mode === "page" ? 2 : 3;
	// A scored CV with a job to write about and an address that passes the strict rule can be invited.
	const canInvite = scored && jobTitle !== undefined && email !== null && isEmail(email);

	const invite = () => {
		if (!canInvite || !email || jobTitle === undefined) return;
		// Opened inside the click (or key press), so the browser doesn't take it for a popup. The app sends nothing itself.
		window.open(
			gmailComposeUrl({ to: email, candidateName: candidate.name, jobTitle, companyName: org.name }),
			"_blank",
			"noopener,noreferrer",
		);
		if (candidate.decision !== "shortlisted") decision.choose("shortlisted", "Gmail draft opened. ");
		else toast.show("Gmail draft opened");
	};

	const copyEmail = (address: string) => {
		const failed = () =>
			toast.error(
				<>
					Couldn't <span className="mk mk-gap">copy</span> the email. Select it and copy it by hand.
				</>,
			);
		if (!navigator.clipboard?.writeText) return failed();
		navigator.clipboard.writeText(address).then(() => toast.show("Email copied"), failed);
	};

	useHotkeys([
		{ keys: "s", label: "Shortlist", group: "Job triage", run: () => decision.choose("shortlisted") },
		{ keys: "x", label: "Mark not a fit", group: "Job triage", run: () => decision.choose("rejected") },
		{ keys: "u", label: "Mark undecided", group: "Job triage", run: () => decision.choose("undecided") },
		{ keys: "o", label: "Open the CV in a new tab", group: "Job triage", run: cv.open },
		{ keys: "e", label: "Invite to a call by email", group: "Job triage", run: invite, enabled: canInvite },
	]);

	// Only looks disabled while it retries, so it keeps keyboard focus; the click is ignored.
	const retryButton = (className: string) =>
		candidate.canRetry && (
			<button
				type="button"
				className={className}
				aria-disabled={retry.isPending}
				onClick={() => {
					if (!retry.isPending) retry.mutate(candidate.id);
				}}
			>
				{retry.isPending ? "Retrying" : "Retry"}
			</button>
		);

	// A promise rather than mutate's callbacks: the job page may move its selection on (and unmount this panel) as
	// soon as the candidate leaves its list, and the confirmation must still be said. A failure shows in the dialog.
	// The toast outlives the page, so it is said here in both modes.
	const confirmDelete = () =>
		remove.mutateAsync().then(
			() => {
				forgetVisit("candidate", candidate.id);
				toast.show(`Deleted “${name}”`);
				if (mode === "page") {
					void navigate({ to: "/dashboard/jobs/$jobId", params: { jobId }, search: view });
				} else {
					setConfirmingDelete(false);
					onDeleted?.(name);
				}
			},
			() => undefined,
		);

	const scoreBlock = <ScoreBlock candidate={candidate} retry={retryButton("btn ghost xs")} size={mode} />;
	const headline = candidate.headline && (
		<p className="mt-2 font-mono text-[13.5px] text-ink-2 [overflow-wrap:anywhere]">{candidate.headline}</p>
	);
	const header =
		mode === "page" ? (
			<PageHeader title={name} actions={scoreBlock} className="mt-3">
				{headline}
				<MetaRow candidate={candidate} onCopyEmail={copyEmail} />
			</PageHeader>
		) : (
			<header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pt-6">
				<div className="min-w-0 flex-[1_1_260px]">
					<h2 className="text-[26px] leading-[1.1] font-[800] tracking-[-0.02em] [overflow-wrap:anywhere] [font-stretch:108%]">
						{name}
					</h2>
					{headline}
					<MetaRow candidate={candidate} onCopyEmail={copyEmail} />
				</div>
				{scoreBlock}
			</header>
		);

	const menu = (
		<Menu
			label={`More actions for ${name}`}
			trigger={<MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />}
			triggerClassName="icon-btn"
			align="end"
		>
			{mode === "panel" && (
				<MenuItem href={candidatePath(jobId, candidate.id, view)} icon={<Maximize2 />}>
					Open full page
				</MenuItem>
			)}
			<MenuItem onSelect={cv.open} icon={<ExternalLink />} shortcut={desk ? "o" : undefined}>
				Open CV in a new tab
			</MenuItem>
			{email && (
				<MenuItem onSelect={() => copyEmail(email)} icon={<Copy />}>
					Copy email
				</MenuItem>
			)}
			{isAdmin && (
				<>
					<MenuSeparator />
					<MenuItem destructive onSelect={() => setConfirmingDelete(true)} icon={<Trash2 />}>
						Delete candidate
					</MenuItem>
				</>
			)}
		</Menu>
	);
	const inviteButton = canInvite && (
		<Tooltip
			content={
				<>
					Opens a Gmail draft and shortlists {name}
					{desk && <span className="ml-2 text-paper/70">E</span>}
				</>
			}
		>
			<button type="button" className="btn ghost xs" aria-keyshortcuts="E" onClick={invite}>
				<Mail size={16} strokeWidth={2} aria-hidden="true" />
				Invite to a call
			</button>
		</Tooltip>
	);
	const bar = (variant: "bar" | "card") => (
		<DecisionBar
			candidate={candidate}
			onChoose={(next) => decision.choose(next)}
			error={decision.error}
			hints={desk}
			variant={variant}
			headingLevel={level}
			menu={menu}
			invite={inviteButton}
		/>
	);

	const summary = candidate.summary && (
		<p
			className={`max-w-[68ch] leading-[1.55] text-ink-2 ${mode === "page" ? "text-[clamp(17px,1.45vw,20px)]" : "text-[17px]"}`}
		>
			{candidate.summary}
		</p>
	);

	const frame = wide
		? "h-[min(1200px,calc(100dvh-120px))] min-h-[560px]"
		: mode === "page"
			? "h-[75dvh] min-h-[480px]"
			: "h-[max(480px,calc(100dvh-240px))]";

	const tabs = (
		<Tabs value={tab} onChange={showTab}>
			<TabList label={`About ${name}`}>
				<Tab value="evidence">Evidence</Tab>
				<Tab value="profile">Profile</Tab>
				<Tab value="cv">CV</Tab>
				<Tab value="questions">
					<span className="max-[420px]:sr-only">Interview questions</span>
					<span aria-hidden="true" className="hidden max-[420px]:inline">
						Questions
					</span>
				</Tab>
			</TabList>
			<TabPanel value="evidence" className="pt-5">
				{scored && requirements.length > 0 ? (
					<Evidence requirements={requirements} headingLevel={level} />
				) : (
					<TabNote>
						{working
							? "The evidence shows here once the CV is read."
							: scored
								? "There were no requirements to check this CV against."
								: "There's no evidence because the CV couldn't be scored."}
					</TabNote>
				)}
			</TabPanel>
			<TabPanel value="profile" className="pt-5">
				<ProfileCard
					profile={candidate.profile}
					headingLevel={level}
					hideHeading
					fallback={
						<TabNote>
							{working
								? "The profile shows here once the CV is read."
								: "The CV doesn't give contact details, links, skills or experience we could read."}
						</TabNote>
					}
				/>
			</TabPanel>
			<TabPanel value="cv" className="pt-5">
				<CvPreview
					name={name}
					fileName={candidate.fileName}
					fileSize={candidate.fileSize}
					preview={cvPreview.preview}
					onRetry={cvPreview.retry}
					cv={cv}
					inline={desk}
					frameClassName={frame}
				/>
			</TabPanel>
			<TabPanel value="questions" className="pt-5">
				{scored ? (
					<InterviewQuestions jobId={jobId} candidate={candidate} headingLevel={level} hideHeading />
				) : (
					<TabNote>You can write interview questions once the CV is scored.</TabNote>
				)}
			</TabPanel>
		</Tabs>
	);

	const Heading = level === 2 ? "h2" : "h3";
	const cvFile = (
		<section aria-label="CV file" className="rounded-xl bg-sheet p-5 shadow-card">
			<p className="font-mono text-[12px] leading-[1.4] tracking-[.08em] text-ink-muted uppercase">CV file</p>
			<p className="mt-1 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{candidate.fileName}</p>
			<p className="font-mono text-[12.5px] text-ink-muted">{formatFileSize(candidate.fileSize)}</p>
			<div className="mt-3">
				<OpenCvAction cv={cv} />
			</div>
			{cv.error && tab !== "cv" && (
				<p role="alert" className="mt-2 text-[14px] text-gap-ink">
					✕ {cv.error}
				</p>
			)}
		</section>
	);
	const deleteZone = isAdmin && mode === "page" && (
		<section aria-labelledby="delete-candidate-h" className="rounded-xl border border-line p-5">
			<Heading id="delete-candidate-h" className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
				Delete this candidate
			</Heading>
			<p className="mt-2 text-[14px] text-ink-2">
				Only admins can delete a candidate. They're removed for everyone at {org.name}, and the job still counts their
				CV toward its CV limit.
			</p>
			<button type="button" className="btn danger xs mt-4" onClick={() => setConfirmingDelete(true)}>
				Delete candidate
			</button>
		</section>
	);

	// What needs saying before anything else: a refresh that failed, a CV that couldn't be scored, a retry refused.
	const notices = (refreshFailed || candidate.status === "failed" || retry.isError) && (
		<div className="flex flex-col items-start gap-4">
			{refreshFailed && <RefreshFailed polling={working} onRetry={onRefresh} />}
			{candidate.status === "failed" && (
				<div role="alert" className="flex w-full max-w-xl flex-col items-start gap-3 rounded-xl bg-sheet p-5 shadow-card">
					<Heading className="text-[17px] leading-[1.2] font-[800] [font-stretch:108%]">
						<span className="mk mk-gap">✕ We couldn't score this CV</span>
					</Heading>
					<p className="text-[15px] text-ink-2">{failureMessage(candidate)}</p>
					{candidate.canRetry ? (
						retryButton("btn xs")
					) : (
						<p className="text-[15px] text-ink-2">
							We've tried this CV {MAX_SCORING_RUNS} times. It may not be a readable PDF.
						</p>
					)}
				</div>
			)}
			{retry.isError && (
				<p role="alert" className="text-[14px] text-gap-ink">
					✕ {retry.error.message}
				</p>
			)}
		</div>
	);

	return (
		<article aria-label={mode === "panel" ? name : undefined}>
			{header}
			{wide ? (
				<div className="mt-8 grid grid-cols-[minmax(0,1fr)_340px] items-start gap-8">
					<div className="flex min-w-0 flex-col gap-6">
						{notices}
						{summary}
						{tabs}
					</div>
					<aside aria-label="Decision and note" className="flex flex-col gap-4 self-stretch">
						{/* The decision stays in view while the evidence scrolls; the rest of the column scrolls under it, hidden
						    by a band of paper above and below the card. */}
						<div className="sticky top-0 z-10 -mt-6 -mb-4 bg-paper pt-6 pb-4">{bar("card")}</div>
						<div className="rounded-xl bg-sheet p-5 shadow-card">
							<NoteField jobId={jobId} candidate={candidate} headingLevel={level} />
						</div>
						{cvFile}
						{deleteZone}
					</aside>
				</div>
			) : (
				<>
					{notices && <div className="mt-6">{notices}</div>}
					<div
						className={`sticky top-0 z-10 mt-5 border-b border-line bg-paper py-3 max-md:static ${mode === "page" ? PAGE_BLEED : PANEL_BLEED}`}
					>
						{bar("bar")}
					</div>
					<div className="mt-4">
						<NoteToggle jobId={jobId} candidate={candidate} />
					</div>
					{summary && <div className="mt-6">{summary}</div>}
					<div className="mt-6">{tabs}</div>
					{mode === "page" && (
						<div className="mt-10 grid gap-4 sm:grid-cols-2">
							{cvFile}
							{deleteZone}
						</div>
					)}
				</>
			)}

			{confirmingDelete && (
				<ConfirmDialog
					heading={`Delete “${name}”?`}
					confirmLabel="Delete candidate"
					busyLabel="Deleting"
					busy={remove.isPending}
					error={remove.isError ? remove.error.message : null}
					onCancel={() => {
						remove.reset();
						setConfirmingDelete(false);
					}}
					onConfirm={confirmDelete}
				>
					It's removed for everyone at {org.name}, with the CV file. You can't undo this.
				</ConfirmDialog>
			)}
		</article>
	);
}
