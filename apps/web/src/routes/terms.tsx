import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "../legal/terms-page.tsx";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});
