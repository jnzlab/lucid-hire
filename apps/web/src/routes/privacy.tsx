import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "../legal/privacy-page.tsx";

export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});
