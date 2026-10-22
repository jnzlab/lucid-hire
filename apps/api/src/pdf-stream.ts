// What every PDF starts with. The Content-Type header and the file name are the client's word; the bytes are not.
const PDF_MAGIC = new TextEncoder().encode("%PDF-");

export type PdfUpload = {
	// The whole body, to hand to R2. It has a known length, which R2 needs for a stream.
	readable: ReadableStream<Uint8Array>;
	// Resolves when the body has been passed on; rejects if the client's stream fails. Await it with the R2 write.
	pumped: Promise<void>;
};

// Reads only as many chunks as it takes to see the first five bytes, and says whether the body is a PDF. If it is,
// returns a stream of the whole body, those chunks first and the rest piped through natively, so a 5 MB file is
// never buffered or touched by JavaScript (a Worker on the free plan has 10 ms of CPU). If it isn't, the rest of the
// body is dropped unread and the result is null.
export async function peekPdf(body: ReadableStream<Uint8Array>, size: number): Promise<PdfUpload | null> {
	const reader = body.getReader();
	// The chunks read so far, and the first five bytes across them.
	const head: Uint8Array[] = [];
	const prefix: number[] = [];
	try {
		while (prefix.length < PDF_MAGIC.length) {
			const { done, value } = await reader.read();
			if (done) break;
			head.push(value);
			prefix.push(...value.subarray(0, PDF_MAGIC.length - prefix.length));
		}
	} catch {
		return null;
	}
	if (!PDF_MAGIC.every((byte, index) => prefix[index] === byte)) {
		await reader.cancel().catch(() => {});
		return null;
	}

	reader.releaseLock();
	const { readable, writable } = new FixedLengthStream(size);
	const pumped = (async () => {
		const writer = writable.getWriter();
		try {
			for (const chunk of head) await writer.write(chunk);
		} finally {
			writer.releaseLock();
		}
		await body.pipeTo(writable);
	})();
	// The caller awaits it next to the R2 write; this keeps a failure from being reported as unhandled before that.
	pumped.catch(() => {});
	return { readable, pumped };
}
