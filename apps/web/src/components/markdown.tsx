import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// A job description as GitHub-flavoured Markdown. Raw HTML in the text is not rendered, unsafe link schemes are
// dropped by react-markdown, and every link opens in a new tab without handing over the page.
export default function MarkdownView({ children }: { children: string }) {
	return (
		<div className="prose-lh">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ node: _node, children: text, ...props }) => (
						<a {...props} target="_blank" rel="noopener noreferrer">
							{text}
						</a>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
