import { publicJobUrl } from "../lib/public-jobs.ts";
import { useToast } from "../ui/use-toast.ts";

// Copies a job's public apply link and says so in a toast. Call it straight from the click (or menu choice), so the
// browser still counts it as the person's own action and lets the clipboard be written.
export function useCopyApplyLink() {
	const toast = useToast();
	return async (job: { title: string; slug: string }) => {
		try {
			await navigator.clipboard.writeText(publicJobUrl(job.slug));
			toast.show(`Apply link copied for ${job.title}`);
		} catch {
			toast.error(
				<>
					Couldn't <span className="mk mk-gap">copy</span> the link. Open the job and copy it from there.
				</>,
			);
		}
	};
}
