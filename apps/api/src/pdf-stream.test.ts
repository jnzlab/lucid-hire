import { describe, expect, it } from "vitest";
import { peekPdf } from "./pdf-stream.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

// A stream that hands out the given chunks one at a time, and counts how many were taken.
function source(chunks: Uint8Array[]) {
	let next = 0;
	const stream = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				if (next < chunks.length) controller.enqueue(chunks[next++]);
				else controller.close();
			},
		},
		{ highWaterMark: 0 },
	);
	return { stream, pulled: () => next };
}

const sizeOf = (chunks: Uint8Array[]) => chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
const drain = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

describe("peekPdf", () => {
	it("passes a PDF through unchanged, whole", async () => {
		const chunks = [bytes("%PDF-1.4\n"), bytes("body body body"), bytes("\n%%EOF")];
		const { stream } = source(chunks);
		const pdf = await peekPdf(stream, sizeOf(chunks));
		expect(pdf).not.toBeNull();
		const [received] = await Promise.all([drain(pdf!.readable), pdf!.pumped]);
		expect(new TextDecoder().decode(received)).toBe("%PDF-1.4\nbody body body\n%%EOF");
	});

	it("looks at the first chunk only when it holds the five bytes, and reads no further ahead", async () => {
		const chunks = [bytes("%PDF-1.7 first chunk"), bytes("second"), bytes("third")];
		const { stream, pulled } = source(chunks);
		const pdf = await peekPdf(stream, sizeOf(chunks));
		expect(pdf).not.toBeNull();
		// Nothing past the first chunk has been asked for yet: the rest is not buffered.
		expect(pulled()).toBe(1);
		await Promise.all([drain(pdf!.readable), pdf!.pumped]);
	});

	it("finds the five bytes when they arrive in pieces", async () => {
		const chunks = [bytes("%"), bytes("PD"), bytes("F-"), bytes("1.4 rest")];
		const { stream } = source(chunks);
		const pdf = await peekPdf(stream, sizeOf(chunks));
		expect(pdf).not.toBeNull();
		const [received] = await Promise.all([drain(pdf!.readable), pdf!.pumped]);
		expect(new TextDecoder().decode(received)).toBe("%PDF-1.4 rest");
	});

	it("refuses anything else, without reading the rest", async () => {
		for (const text of ["\x89PNG\r\n\x1a\n and more", "PK\x03\x04 a zip", "<html>%PDF-</html>", " %PDF-1.4", "%PDF", "", "%pdf-1.4"]) {
			const chunks = [bytes(text), bytes("never read"), bytes("never read")];
			const { stream, pulled } = source(chunks);
			expect(await peekPdf(stream, sizeOf(chunks)), JSON.stringify(text)).toBeNull();
			// At most the chunk that settles it: one that is too short to tell needs the next.
			expect(pulled()).toBeLessThanOrEqual(text.length < 5 ? 2 : 1);
		}
	});

	it("fails the pump, not the caller, when the body is shorter than it said", async () => {
		const chunks = [bytes("%PDF-1.4 short")];
		const { stream } = source(chunks);
		const pdf = await peekPdf(stream, sizeOf(chunks) + 10);
		expect(pdf).not.toBeNull();
		await expect(Promise.all([drain(pdf!.readable), pdf!.pumped])).rejects.toThrow();
	});
});
