import { useEffect, useState } from "react";

// Screen readers only announce text that is added to a live region already on the page. So the region is
// rendered first and the message goes in just after the page has mounted.
const ANNOUNCE_DELAY_MS = 100;

// A confirmation that comes with the page, like "Deleted “X”" after a delete, shown and announced politely.
export function AnnouncedBanner({ message, className = "" }: { message: string | undefined; className?: string }) {
	const [shown, setShown] = useState<string>();
	useEffect(() => {
		const timer = setTimeout(() => setShown(message), ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [message]);

	return (
		<div aria-live="polite">
			{shown && (
				<p
					className={`inline-flex min-h-11 items-center gap-2.5 rounded-md bg-ink px-3.5 font-mono text-[13.5px] text-paper ${className}`}
				>
					{shown}
				</p>
			)}
		</div>
	);
}
