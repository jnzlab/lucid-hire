import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CandidatesSection, StatusButton } from "../candidates/candidates-section.tsx";
import { useOrg } from "../dashboard/org.ts";
import { ApiError } from "../lib/api.ts";
import { useCandidates, useUploadCvs } from "../lib/candidates.ts";
import { type Job, useJob } from "../lib/jobs.ts";
import { rememberVisit } from "../lib/recent.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { UpgradeAction } from "../settings/upgrade.tsx";
import { Tab, TabList, TabPanel, Tabs } from "../ui/tabs.tsx";
import { useToast } from "../ui/use-toast.ts";
import { SectionError, SectionLoading } from "./job-ui.tsx";
import { capacityOf } from "./workspace/capacity.ts";
import { DescriptionTab } from "./workspace/description-tab.tsx";
import { JobHeader } from "./workspace/job-header.tsx";
import { DropOverlay, UploadDrawer, UploadPill } from "./workspace/upload-drawer.tsx";
import { isPending, summarise } from "./workspace/uploads.ts";
import { usePageDrop } from "./workspace/use-page-drop.ts";
import { useStatusChange } from "./workspace/use-status-change.ts";

// The workspace's side gutters: it uses the content area's full width, not the 1280px column.
const GUTTER = "px-[clamp(16px,2.5vw,32px)]";
const ROUTE = "/dashboard/jobs/$jobId/";

// The job's triage workspace. From 1100px it fills the window exactly (header and tabs on top, the list and the
// selected candidate scrolling on their own below), so the page itself never scrolls; narrower, it is a normal page.
export function JobPage({ jobId }: { jobId: string }) {
	const job = useJob(jobId);
	useDocumentTitle(job.data ? `${job.data.title} · LucidHire` : "Job · LucidHire");

	return (
		<div className="flex flex-col min-[1100px]:h-dvh min-[1100px]:overflow-hidden">
			{job.isPending ? (
				<div className={`${GUTTER} page`}>
					<SectionLoading label="Loading job" page />
				</div>
			) : job.isError ? (
				<div className={`${GUTTER} page`}>
					<JobLoadError error={job.error} onRetry={() => void job.refetch()} />
				</div>
			) : (
				// Keyed by job: the router keeps this page mounted from one job to the next, and a half-finished upload
				// (its files, its retry) must never carry over to another job.
				<JobWorkspace key={job.data.id} job={job.data} />
			)}
		</div>
	);
}

export function JobLoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
	const missing = error instanceof ApiError && error.status === 404;
	return (
		<SectionError
			level={1}
			title={missing ? "This job doesn't exist" : "We couldn't load this job"}
			message={missing ? "It may have been deleted, or it belongs to another company." : error.message}
			action={
				missing ? (
					<Link to="/dashboard/jobs" className="btn">
						Back to your jobs
					</Link>
				) : (
					<button type="button" className="btn" onClick={onRetry}>
						Try again
					</button>
				)
			}
		/>
	);
}

function JobWorkspace({ job }: { job: Job }) {
	const org = useOrg();
	const toast = useToast();
	const search = useSearch({ from: ROUTE });
	const navigate = useNavigate({ from: ROUTE });
	const candidates = useCandidates(job.id);
	const list = candidates.data?.candidates;
	const capacity = capacityOf(job, candidates.data);
	const status = useStatusChange(job);
	const tab = search.tab ?? "candidates";

	useEffect(() => {
		rememberVisit({ kind: "job", id: job.id, title: job.title });
	}, [job.id, job.title]);

	// The upload belongs to the page, so it carries on while the drawer is closed.
	const uploads = useUploadCvs(job.id);
	const [withDetails, setWithDetails] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	// The upload list as the drawer last showed it. A batch that changes it while the drawer is closed (one that
	// finished with failures, say) is news, and the header pill says so until the drawer opens again.
	const [seenItems, setSeenItems] = useState(uploads.items);
	const failedUnseen = !drawerOpen && uploads.items !== seenItems;
	const openDrawer = () => {
		setDrawerOpen(true);
		setSeenItems(uploads.items);
	};
	const closeDrawer = () => {
		setDrawerOpen(false);
		setSeenItems(uploads.items);
	};
	const busy = uploads.items.some(isPending);

	// A batch that ends while the drawer is closed says how it went in a toast.
	const wasBusy = useRef(false);
	const announceBatch = useEffectEvent(() => {
		if (drawerOpen) return;
		const message = summarise(uploads.items);
		if (!message) return;
		if (uploads.items.some(({ state }) => state === "failed")) {
			toast.error(message, { action: { label: "Review", onClick: openDrawer } });
		} else toast.show(message);
	});
	useEffect(() => {
		if (wasBusy.current && !busy) announceBatch();
		wasBusy.current = busy;
	}, [busy]);

	// "Upload CVs" elsewhere (the sidebar, the palette, the overview) arrives with #upload: open the drawer, and take
	// the hash off so the same link works again.
	const hash = useRouterState({ select: (state) => state.location.hash });
	const [seenHash, setSeenHash] = useState("");
	if (hash !== seenHash) {
		setSeenHash(hash);
		if (hash === "upload") openDrawer();
	}
	useEffect(() => {
		if (hash === "upload") void navigate({ search: (previous) => previous, hash: "", replace: true, resetScroll: false });
	}, [hash, navigate]);

	// CVs dropped anywhere on the page go into the upload, which the drawer then shows.
	const blocked = capacity.note ?? (busy ? "Wait for the current upload to finish, then drop more CVs." : null);
	const dragging = usePageDrop((files) => {
		if (blocked) {
			toast.error(blocked);
			return;
		}
		uploads.choose(files, capacity.slotsLeft, capacity.limit, withDetails);
		openDrawer();
	});

	const noteAction =
		job.status !== "open" ? (
			<StatusButton status={status} />
		) : capacity.upgradable ? (
			<UpgradeAction isAdmin={org.role === "admin"} />
		) : undefined;

	return (
		<Tabs
			value={tab}
			onChange={(next) =>
				void navigate({
					search: (previous) => ({ ...previous, tab: next === "description" ? "description" : undefined }),
					replace: true,
					resetScroll: false,
				})
			}
		>
			<div className={`${GUTTER} flex-none pt-[clamp(20px,2.5vw,32px)]`}>
				<JobHeader
					job={job}
					list={list}
					capacity={capacity}
					status={status}
					onUpload={openDrawer}
					uploadPill={!drawerOpen && <UploadPill uploads={uploads} failedUnseen={failedUnseen} onOpen={openDrawer} />}
				/>
				<TabList label="Job" className="mt-5">
					<Tab value="candidates" count={list?.length}>
						Candidates
					</Tab>
					<Tab value="description">Description</Tab>
				</TabList>
			</div>
			<TabPanel
				value="candidates"
				focusable={false}
				className={`${GUTTER} flex flex-col pt-4 pb-[clamp(16px,2.5vw,32px)] min-[1100px]:min-h-0 min-[1100px]:flex-1`}
			>
				<CandidatesSection job={job} candidates={candidates} capacity={capacity} status={status} onUpload={openDrawer} />
			</TabPanel>
			<TabPanel
				value="description"
				className={`${GUTTER} pt-4 pb-[clamp(24px,3vw,40px)] min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto`}
			>
				<DescriptionTab job={job} />
			</TabPanel>

			<UploadDrawer
				open={drawerOpen}
				onClose={closeDrawer}
				job={job}
				capacity={capacity}
				uploads={uploads}
				withDetails={withDetails}
				onWithDetailsChange={setWithDetails}
				noteAction={noteAction}
			/>
			{dragging && !drawerOpen && <DropOverlay jobTitle={job.title} blocked={blocked} />}
		</Tabs>
	);
}
