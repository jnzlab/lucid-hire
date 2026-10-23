import type { UploadItem, useUploadCvs } from "../../lib/candidates.ts";

export type Uploads = ReturnType<typeof useUploadCvs>;

// A file of the current batch that is still on its way.
export const isPending = ({ state }: UploadItem) => state === "waiting" || state === "uploading";

// The tally of a batch in words: what the upload zone reads out to screen readers, and what the toast says when a
// batch ends while the drawer is closed.
export function summarise(items: UploadItem[]) {
	const pending = items.filter(isPending).length;
	if (pending > 0) return `Uploading ${pending} ${pending === 1 ? "file" : "files"}`;
	const staged = items.filter(({ state }) => state === "staged").length;
	if (staged > 0) return `${staged} ${staged === 1 ? "CV" : "CVs"} ready to upload`;
	const failed = items.filter(({ state }) => state === "failed").length;
	const done = items.length - failed;
	if (items.length === 0) return null;
	if (failed === 0) return `${done} ${done === 1 ? "CV" : "CVs"} uploaded`;
	return done === 0 ? `${failed} not uploaded` : `${done} uploaded · ${failed} not uploaded`;
}
