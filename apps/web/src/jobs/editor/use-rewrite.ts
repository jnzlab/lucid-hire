import { useEffect, useRef, useState } from "react";
import { JOB_TITLE_MIN, useEnhanceDescription } from "../../lib/jobs.ts";
import { useToast } from "../../ui/use-toast.ts";
import { tidyTitle } from "./validate.ts";

// "Improve with AI": sends the notes (and the title, once it's a real one) to be rewritten, swaps the rewrite in and
// keeps the notes as they were, so a toast and an inline button can put them back. The undo lasts until the
// recruiter edits the rewrite, because after that putting the old notes back would throw their edit away.
export function useRewrite({
	title,
	description,
	setDescription,
	onNoNotes,
}: {
	title: string;
	description: string;
	setDescription: (text: string) => void;
	// There's nothing to rewrite yet.
	onNoNotes: () => void;
}) {
	const enhance = useEnhanceDescription();
	const toast = useToast();
	// The notes from before the rewrite, while it can still be undone. A ref too, for the toast's Undo.
	const [before, setBefore] = useState<string | null>(null);
	const beforeRef = useRef<string | null>(null);
	const toastId = useRef<string | null>(null);

	// The toast's Undo means nothing once the form is gone.
	const { dismiss } = toast;
	useEffect(
		() => () => {
			if (toastId.current) dismiss(toastId.current);
		},
		[dismiss],
	);

	const forget = () => {
		beforeRef.current = null;
		setBefore(null);
		if (toastId.current) toast.dismiss(toastId.current);
		toastId.current = null;
	};

	const undo = () => {
		const notes = beforeRef.current;
		if (notes === null) return;
		forget();
		setDescription(notes);
	};

	// Ignored while it runs or the form saves: the button only looks disabled, so it keeps keyboard focus.
	const improve = (saving: boolean) => {
		if (enhance.isPending || saving) return;
		const notes = description.trim();
		if (!notes) {
			onNoNotes();
			return;
		}
		const cleanTitle = tidyTitle(title);
		enhance.mutate(
			{ title: cleanTitle.length >= JOB_TITLE_MIN ? cleanTitle : undefined, description: notes },
			{
				onSuccess: (rewritten) => {
					forget();
					beforeRef.current = description;
					setBefore(description);
					setDescription(rewritten);
					toastId.current = toast.show({ message: "Description rewritten", action: { label: "Undo", onClick: undo } });
				},
			},
		);
	};

	return {
		improve,
		undo,
		// Call on every edit the recruiter makes to the description.
		edited: () => {
			if (beforeRef.current !== null) forget();
		},
		pending: enhance.isPending,
		error: enhance.isError ? enhance.error : null,
		rewritten: before !== null,
	};
}
