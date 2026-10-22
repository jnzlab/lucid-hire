import { describe, expect, it } from "vitest";
import { type ExportRow, buildCsv, csvCell, exportFileName } from "./candidates-export.ts";

describe("csvCell", () => {
	it("leaves plain text and numbers alone, and empties null", () => {
		expect(csvCell("Ada Lovelace")).toBe("Ada Lovelace");
		expect(csvCell(87)).toBe("87");
		expect(csvCell(null)).toBe("");
		expect(csvCell(undefined)).toBe("");
	});

	it("quotes a field with a comma, a quote or a line break, and doubles the quotes", () => {
		expect(csvCell("Swift, SwiftUI")).toBe('"Swift, SwiftUI"');
		expect(csvCell('She said "yes"')).toBe('"She said ""yes"""');
		expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
		expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
	});

	it("puts an apostrophe in front of anything a spreadsheet would run as a formula", () => {
		expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
		expect(csvCell("+44 7946 095 800")).toBe("'+44 7946 095 800");
		expect(csvCell("-1+1")).toBe("'-1+1");
		expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
		expect(csvCell("\tTabbed")).toBe("'\tTabbed");
		expect(csvCell("\rReturn")).toBe('"\'\rReturn"');
		// Only the first character counts.
		expect(csvCell("a=b")).toBe("a=b");
	});
});

describe("exportFileName", () => {
	it("is the job title as a slug, then the decision unless it is all", () => {
		expect(exportFileName("Senior iOS Engineer", "all")).toBe("senior-ios-engineer-applicants.csv");
		expect(exportFileName("Senior iOS Engineer", "shortlisted")).toBe("senior-ios-engineer-shortlisted-applicants.csv");
		expect(exportFileName("Café Manager (Lyon) / Paris", "rejected")).toBe("cafe-manager-lyon-paris-rejected-applicants.csv");
	});

	it("never puts anything but letters, digits and hyphens in the name, and always has one", () => {
		expect(exportFileName('"; filename=evil.exe', "all")).toBe("filename-evil-exe-applicants.csv");
		expect(exportFileName("!!!", "undecided")).toBe("job-undecided-applicants.csv");
		expect(exportFileName("x".repeat(200), "all").length).toBeLessThan(90);
	});
});

const row = (fields: Partial<ExportRow>): ExportRow => ({
	rank: 1,
	name: "Ada Lovelace",
	fileName: "ada.pdf",
	email: null,
	phone: null,
	score: 80,
	status: "scored",
	decision: "undecided",
	note: null,
	decidedAt: null,
	createdAt: new Date("2026-10-22T12:00:00Z"),
	summary: null,
	matching: null,
	missing: null,
	error: null,
	...fields,
});

describe("buildCsv", () => {
	it("starts with a BOM, ends each record with CRLF and has the 14 columns", () => {
		const csv = buildCsv([row({})]);
		expect(csv.startsWith("﻿Rank,Name,Email,Phone,Match score,Status,Decision,Note,Decided at,Applied at,")).toBe(true);
		const lines = csv.slice(1).split("\r\n");
		expect(lines).toHaveLength(3);
		expect(lines[2]).toBe("");
		expect(lines[0].split(",")).toHaveLength(14);
		expect(lines[1]).toBe("1,Ada Lovelace,,,80,scored,Undecided,,,2026-10-22T12:00:00.000Z,,,,");
		expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
	});

	it("writes the requirements, the decision, the note and the contact details, and guards every text cell", () => {
		const csv = buildCsv([
			row({
				name: "=cmd|' /C calc'!A0",
				email: "ada@example.com",
				phone: "+44 7946 095 800",
				decision: "shortlisted",
				decidedAt: new Date("2026-10-23T09:00:00Z"),
				note: 'Call "soon",\nnot later',
				summary: "Strong Swift, no Kotlin.",
				matching: "Swift; SwiftUI",
				missing: "Kotlin",
			}),
		]);
		const record = csv.slice(1).split("\r\n").slice(1).join("\r\n");
		expect(record).toBe(
			[
				"1",
				"'=cmd|' /C calc'!A0",
				"ada@example.com",
				"'+44 7946 095 800",
				"80",
				"scored",
				"Shortlisted",
				'"Call ""soon"",\nnot later"',
				"2026-10-23T09:00:00.000Z",
				"2026-10-22T12:00:00.000Z",
				'"Strong Swift, no Kotlin."',
				"Swift; SwiftUI",
				"Kotlin",
				"",
			].join(",") + "\r\n",
		);
	});

	it("leaves rank and score empty for a CV without a score, and gives the reason a CV failed", () => {
		const csv = buildCsv([
			row({ status: "failed", score: null, rank: null, name: null, error: "We couldn't read this file as a CV." }),
		]);
		expect(csv.slice(1).split("\r\n")[1]).toBe(
			",ada.pdf,,,,failed,Undecided,,,2026-10-22T12:00:00.000Z,,,,We couldn't read this file as a CV.",
		);
	});
});
