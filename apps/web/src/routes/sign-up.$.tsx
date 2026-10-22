import { createFileRoute } from "@tanstack/react-router";
import { SignUpPage } from "../auth/sign-up-page.tsx";

export const Route = createFileRoute("/sign-up/$")({
	component: SignUpPage,
});
