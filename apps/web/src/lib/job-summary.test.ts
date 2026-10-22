import { describe, expect, it } from "vitest";
import { META_DESCRIPTION_MAX, stripMarkdown, summarise } from "./job-summary.ts";

describe("stripMarkdown", () => {
	it("turns Markdown into one line of plain text", () => {
		const md = "## Role\n\nWe need a **senior** engineer.\n\n- Build [APIs](https://x.dev)\n- [x] Ship `fast`\n\n> Remote\n\n1. Apply";
		expect(stripMarkdown(md)).toBe("Role We need a senior engineer. Build APIs Ship fast Remote Apply");
	});

	it("drops code blocks, images, tables rules and HTML", () => {
		const md = "Intro\n```js\nconst x = 1;\n```\n![logo](a.png)\n| a | b |\n| --- | --- |\n| 1 | 2 |\n<b>bold</b>\n---";
		expect(stripMarkdown(md)).toBe("Intro a b 1 2 bold");
	});
});

describe("summarise", () => {
	it("keeps short text whole", () => {
		expect(summarise("**Hi** there", 160)).toBe("Hi there");
	});

	it("cuts at a word boundary within the limit, with an ellipsis", () => {
		const text = "word ".repeat(100);
		const out = summarise(text, META_DESCRIPTION_MAX);
		expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
		expect(out.endsWith("word…")).toBe(true);
	});

	it("cuts a single long word hard", () => {
		const out = summarise("x".repeat(500), 180);
		expect(out).toHaveLength(180);
		expect(out.endsWith("…")).toBe(true);
	});
});
