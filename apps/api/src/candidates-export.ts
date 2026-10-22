import { z } from "zod";
import type { Candidate } from "./candidates.ts";

// Which decisions an export holds.
export const EXPORT_DECISIONS = ["all", "shortlisted", "undecided", "rejected"] as const;
export const exportQuery = z.object({
	decision: z
		.enum(EXPORT_DECISIONS, { error: "Choose all, shortlisted, undecided or rejected" })
		.default("all"),
});
export type ExportDecision = z.infer<typeof exportQuery>["decision"];

const HEADER = [
	"Rank",
	"Name",
	"Email",
	"Phone",
	"Match score",
	"Status",
	"Decision",
	"Note",
	"Decided at",
	"Applied at",
	"Summary",
	"Matching requirements",
	"Missing requirements",
	"Failure reason",
];

// A spreadsheet runs a cell that starts with one of these as a formula, and a CV or a note can be written by anyone.
// The apostrophe makes it plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

// One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break, with quotes doubled.
export function csvCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	let text = String(value);
	if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const label = (decision: string) => decision.charAt(0).toUpperCase() + decision.slice(1);
const iso = (date: Date | null) => (date ? date.toISOString() : "");

// The rows of the file: CRLF between records, a BOM first so Excel reads the UTF-8 and a trailing line break.
export function buildCsv(rows: (Candidate & { email: string | null; phone: string | null })[]): string {
	const lines = rows.map((c) => {
		const requirements = c.requirements ?? [];
		return [
			c.rank,
			c.name || c.fileName,
			c.email,
			c.phone,
			c.status === "scored" ? c.score : null,
			c.status,
			label(c.decision),
			c.note,
			iso(c.decidedAt),
			iso(c.createdAt),
			c.summary,
			requirements.filter((r) => r.met).map((r) => r.label).join("; "),
			requirements.filter((r) => !r.met).map((r) => r.label).join("; "),
			c.status === "failed" ? c.error : null,
		]
			.map(csvCell)
			.join(",");
	});
	return `﻿${[HEADER.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

// "Senior iOS Engineer" as "senior-ios-engineer": lower case, letters and digits, one hyphen between words.
function slug(title: string): string {
	const words = title
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return words || "job";
}

// "<job-title-slug>-[decision-]applicants.csv", plain ASCII, so the header needs no encoding.
export function exportFileName(jobTitle: string, decision: ExportDecision): string {
	return `${slug(jobTitle)}-${decision === "all" ? "" : `${decision}-`}applicants.csv`;
}
