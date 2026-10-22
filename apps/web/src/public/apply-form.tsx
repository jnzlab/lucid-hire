import { type DragEvent, type FormEvent, useId, useRef, useState } from "react";
import { Check } from "../components/icons.tsx";
import { CV_MAX_BYTES } from "../lib/candidates.ts";
import { formatFileSize } from "../lib/format.ts";
import { SUPPORT_EMAIL, checkApplicationFile, isValidEmail, useApply } from "../lib/public-jobs.ts";
import { useTurnstile } from "../lib/use-turnstile.ts";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

// The apply panel: email, one PDF, the Turnstile check and a notice about how the CV is used. "Submit application"
// stays disabled until all three are in place.
export function ApplyForm({ slug }: { slug: string }) {
	const emailId = useId();
	const fileId = useId();
	const apply = useApply(slug);
	const turnstile = useTurnstile();
	const { containerRef } = turnstile;
	const [email, setEmail] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const emailTidy = email.trim();
	const emailOk = isValidEmail(emailTidy);
	const ready = emailOk && file !== null && turnstile.token !== null;

	const take = (picked: File | undefined) => {
		if (!picked) return;
		const problem = checkApplicationFile(picked);
		setFileError(problem);
		setFile(problem ? null : picked);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!ready || apply.isPending || !file || !turnstile.token) return;
		apply.mutate(
			{ email: emailTidy, file, captchaToken: turnstile.token },
			// A token works once, so whatever happened, the check starts again.
			{ onSettled: () => turnstile.reset() },
		);
	};

	if (apply.isSuccess) {
		return (
			<div role="status" className="rounded-xl bg-sheet p-6 shadow-card">
				<h2 className="text-[21px] leading-[1.15] font-[800] [font-stretch:108%]">
					<span className="mk">Your CV has been received</span>
				</h2>
				<p className="mt-3 flex items-start gap-2 text-[15px] text-ink-2">
					<span className="mt-0.5 flex-none">
						<Check />
					</span>
					We'll be in touch if your profile is a match.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={submit} noValidate aria-label="Apply for this job" className="rounded-xl bg-sheet p-6 shadow-card">
			<h2 className="text-[21px] leading-[1.15] font-[800] [font-stretch:108%]">Apply for this role</h2>

			<label htmlFor={emailId} className="mt-5 block text-[14px] font-semibold text-ink">
				Email address
			</label>
			<input
				id={emailId}
				name="email"
				type="email"
				autoComplete="email"
				inputMode="email"
				className="field mt-2"
				placeholder="you@example.com"
				value={email}
				onChange={(event) => setEmail(event.target.value)}
				aria-invalid={email.length > 0 && !emailOk}
				aria-describedby={`${emailId}-help`}
			/>
			<p id={`${emailId}-help`} className="mt-2 text-[13px] text-ink-muted">
				{email.length > 0 && !emailOk ? <span className="text-gap-ink">✕ Enter a valid email address</span> : "Where the hiring team can reach you."}
			</p>

			<p className="mt-5 text-[14px] font-semibold text-ink">Your CV</p>
			<div
				onDragEnter={(event) => hasFiles(event) && setDragging(true)}
				onDragOver={(event) => hasFiles(event) && event.preventDefault()}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
				}}
				onDrop={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					setDragging(false);
					take(event.dataTransfer.files[0]);
				}}
				className={`mt-2 rounded-lg border-[1.5px] border-dashed p-4 transition-colors duration-200 ${dragging ? "border-ink bg-marker-soft" : "border-line bg-paper"}`}
			>
				<input
					ref={inputRef}
					id={fileId}
					type="file"
					accept="application/pdf"
					className="peer sr-only"
					aria-describedby={`${fileId}-help`}
					onChange={(event) => {
						take(event.target.files?.[0]);
						// So choosing the same file again still counts as a change.
						event.target.value = "";
					}}
				/>
				{file ? (
					<p className="font-mono text-[13px] text-ink [overflow-wrap:anywhere]">
						{file.name} · {formatFileSize(file.size)}
					</p>
				) : (
					<p id={`${fileId}-help`} className="text-[14px] text-ink-2">
						{dragging ? "Drop your CV" : "Drop your CV here, or choose it."}
					</p>
				)}
				<label
					htmlFor={fileId}
					className="btn ghost mt-3 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink"
				>
					{file ? "Choose a different PDF" : "Choose a PDF"}
				</label>
			</div>
			<p className="mt-2 font-mono text-[12px] text-ink-muted">PDF only · up to {CV_MAX_BYTES / (1024 * 1024)} MB</p>
			{fileError && (
				<p role="alert" className="mt-2 text-[13px] text-gap-ink">
					✕ {fileError}
				</p>
			)}

			<div className="mt-5">
				<div ref={containerRef} aria-label="Security check" className="min-h-[65px]" />
				{turnstile.status === "loading" && (
					<p role="status" className="mt-2 inline-flex items-center gap-2.5 font-mono text-[13px] text-ink-muted">
						<span className="live-dot" aria-hidden="true" />
						Loading the security check
					</p>
				)}
				{turnstile.status === "failed" && (
					<p role="alert" className="mt-2 text-[13px] text-gap-ink">
						✕ The security check didn't pass.{" "}
						<button type="button" className="font-semibold underline" onClick={turnstile.reset}>
							Try again
						</button>
						, or email your CV to{" "}
						<a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>
							{SUPPORT_EMAIL}
						</a>
						.
					</p>
				)}
				{turnstile.status === "unavailable" && (
					<p role="alert" className="mt-2 text-[13px] text-gap-ink">
						✕ The security check didn't load. Check your connection and reload the page, or email your CV to{" "}
						<a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>
							{SUPPORT_EMAIL}
						</a>
						.
					</p>
				)}
			</div>

			<p className="mt-5 text-[13px] text-ink-muted">
				Your CV is read by AI to help the hiring team. They make the decision.{" "}
				<a href="/privacy" className="font-semibold text-ink underline underline-offset-[.18em]">
					Privacy
				</a>
			</p>

			{apply.isError && (
				<p role="alert" className="mt-4 text-[14px] text-gap-ink">
					✕ {apply.error.message}
				</p>
			)}
			<button type="submit" className="btn mt-5 w-full" disabled={!ready || apply.isPending}>
				{apply.isPending ? "Sending" : "Submit application"}
			</button>
		</form>
	);
}
