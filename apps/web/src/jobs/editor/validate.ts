import { JOB_DESCRIPTION_MAX, JOB_TITLE_HINT, JOB_TITLE_MAX, JOB_TITLE_MIN, type JobInput } from "../../lib/jobs.ts";

export type FieldErrors = { title?: string; description?: string };

export const DESCRIPTION_MISSING = "Describe the role: what they'll do and what they need";
export const DESCRIPTION_TOO_LONG = "Keep the description to 20,000 characters or fewer";
export const NOTES_MISSING = "Write a few notes first, then improve them";

// Titles are trimmed and their spaces collapsed, as the API does, before they're checked, compared or saved.
export const tidyTitle = (title: string) => title.trim().replace(/\s+/g, " ");

// The form as it would be saved.
export const tidyInput = ({ title, description }: JobInput): JobInput => ({
	title: tidyTitle(title),
	description: description.trim(),
});

// The same rules the API applies (apps/api/src/jobs.ts), checked before anything is sent. Takes tidied input.
export function validateJob({ title, description }: JobInput): FieldErrors {
	const errors: FieldErrors = {};
	if (title.length < JOB_TITLE_MIN || title.length > JOB_TITLE_MAX) errors.title = JOB_TITLE_HINT;
	if (!description) errors.description = DESCRIPTION_MISSING;
	else if (description.length > JOB_DESCRIPTION_MAX) errors.description = DESCRIPTION_TOO_LONG;
	return errors;
}

// Whether leaving now would lose typing: the tidied title or the trimmed description differs from what was saved.
export function isDirty(current: JobInput, saved: JobInput): boolean {
	return tidyTitle(current.title) !== tidyTitle(saved.title) || current.description.trim() !== saved.description.trim();
}
