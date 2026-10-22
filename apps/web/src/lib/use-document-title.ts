import { useEffect } from "react";

// Client-side navigation keeps the previous page's <title>, so every page sets its own.
export function useDocumentTitle(title: string) {
	useEffect(() => {
		document.title = title;
	}, [title]);
}
