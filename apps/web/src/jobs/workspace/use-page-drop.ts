import { useEffect, useEffectEvent, useState } from "react";

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

// Files dragged anywhere over the page. True while they hover; `onDrop` gets them when they land anywhere that didn't
// take them itself (the upload zone handles its own drops). Without the dragover handler the browser would open a
// dropped PDF in place of the app, so it is cancelled for the whole page while this is mounted.
export function usePageDrop(onDrop: (files: File[]) => void): boolean {
	const [dragging, setDragging] = useState(false);
	const take = useEffectEvent(onDrop);

	useEffect(() => {
		// dragenter and dragleave fire for every element the pointer crosses, so the depth says when it has left the page.
		let depth = 0;
		const reset = () => {
			depth = 0;
			setDragging(false);
		};
		const enter = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth += 1;
			setDragging(true);
		};
		const leave = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragging(false);
		};
		const over = (event: DragEvent) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const drop = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			reset();
			// The upload zone took it already.
			if (event.defaultPrevented) return;
			event.preventDefault();
			const files = [...(event.dataTransfer?.files ?? [])];
			if (files.length > 0) take(files);
		};
		document.addEventListener("dragenter", enter);
		document.addEventListener("dragleave", leave);
		document.addEventListener("dragover", over);
		document.addEventListener("drop", drop);
		document.addEventListener("dragend", reset);
		return () => {
			document.removeEventListener("dragenter", enter);
			document.removeEventListener("dragleave", leave);
			document.removeEventListener("dragover", over);
			document.removeEventListener("drop", drop);
			document.removeEventListener("dragend", reset);
		};
	}, []);

	return dragging;
}
