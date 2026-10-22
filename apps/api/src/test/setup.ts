// Workers have FixedLengthStream; Node (where the unit tests run) does not. This one checks the length the way the
// runtime does: too many bytes fail the write, too few fail the close.
class FixedLengthStreamShim extends TransformStream<Uint8Array, Uint8Array> {
	constructor(length: number) {
		let seen = 0;
		super({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > length) throw new TypeError("Attempt to write too many bytes through a FixedLengthStream.");
				controller.enqueue(chunk);
			},
			flush() {
				if (seen !== length) throw new TypeError("FixedLengthStream did not see all expected bytes before close().");
			},
		});
	}
}

Object.assign(globalThis, { FixedLengthStream: FixedLengthStreamShim });
