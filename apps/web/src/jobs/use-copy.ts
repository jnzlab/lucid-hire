import { useEffect, useRef, useState } from "react";

const COPIED_MS = 2500;

// Copies text and says so politely. Show `message` in a live region that stays in the page, so screen readers
// hear every change.
export function useCopy() {
	const [message, setMessage] = useState("");
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const copy = async (text: string, done: string) => {
		window.clearTimeout(timer.current);
		try {
			await navigator.clipboard.writeText(text);
			setMessage(done);
		} catch {
			setMessage("Couldn't copy. Select the text and copy it.");
		}
		timer.current = window.setTimeout(() => setMessage(""), COPIED_MS);
	};
	return { message, copy };
}

export type Copy = ReturnType<typeof useCopy>["copy"];
