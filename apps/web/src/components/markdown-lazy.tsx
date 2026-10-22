import { Suspense, lazy } from "react";

// The Markdown renderer is a sizeable library, so it loads only on the pages that show a description.
const MarkdownView = lazy(() => import("./markdown.tsx"));

export function Markdown({ children }: { children: string }) {
	return (
		<Suspense fallback={<p role="status" className="font-mono text-[13px] text-ink-muted">Loading</p>}>
			<MarkdownView>{children}</MarkdownView>
		</Suspense>
	);
}
