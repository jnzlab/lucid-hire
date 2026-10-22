import { useEffect, useState } from "react";

// The current time, refreshed every `intervalMs` while the component is mounted. It is for text that depends on
// how long ago something happened, which would otherwise only change when something else made the page render.
export function useNow(intervalMs: number) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}
