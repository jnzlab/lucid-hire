import { describe, expect, it } from "vitest";
import { formatDate, formatDayMonth, formatFileSize, formatNumber, formatRelative } from "./format.ts";

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

	it("labels a UTC day with the day and month", () => {
		expect(formatDayMonth("2026-10-22")).toBe("22 Oct");
		expect(formatDayMonth("2026-01-01")).toBe("1 Jan");
	});

	it("says how long ago in the words people use", () => {
		const now = new Date(2026, 9, 22, 15, 0, 0).getTime();
		const before = (ms: number) => new Date(now - ms).toISOString();
		expect(formatRelative(before(20_000), now)).toBe("Just now");
		expect(formatRelative(before(5 * 60_000), now)).toBe("5 min ago");
		expect(formatRelative(before(59 * 60_000), now)).toBe("59 min ago");
		expect(formatRelative(before(3 * 3_600_000), now)).toBe("3 h ago");
		expect(formatRelative(new Date(2026, 9, 21, 9, 0).toISOString(), now)).toBe("Yesterday");
		expect(formatRelative(new Date(2026, 9, 19, 9, 0).toISOString(), now)).toBe("19 Oct 2026");
	});
});
