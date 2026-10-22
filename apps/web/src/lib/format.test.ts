import { describe, expect, it } from "vitest";
import { formatDate, formatFileSize, formatNumber } from "./format.ts";

describe("formats", () => {
	it("writes dates the British way, with the month in words", () => {
		expect(formatDate("2026-10-22T12:00:00Z")).toBe("22 Oct 2026");
		expect(formatDate("2026-01-05T09:30:00Z")).toBe("5 Jan 2026");
	});

	it("groups thousands with commas", () => {
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(20_000)).toBe("20,000");
		expect(formatNumber(1_234_567)).toBe("1,234,567");
	});

	it("sizes a CV file in KB, then in MB with one decimal", () => {
		expect(formatFileSize(1)).toBe("1 KB");
		expect(formatFileSize(120_000)).toBe("117 KB");
		expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
		expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});
