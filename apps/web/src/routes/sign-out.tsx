import { createFileRoute } from "@tanstack/react-router";
import { SignOutPage } from "../auth/sign-out-page.tsx";

export const Route = createFileRoute("/sign-out")({
	component: SignOutPage,
});
