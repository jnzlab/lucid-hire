import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountButton } from "./account-button.tsx";

// Clerk's account menu, reduced to what it is given: the links we add to it.
vi.mock("@clerk/react", () => {
	const UserButton = Object.assign(({ children }: { children?: ReactNode }) => <div>{children}</div>, {
		MenuItems: ({ children }: { children?: ReactNode }) => <ul aria-label="Account menu">{children}</ul>,
		Link: ({ label, href }: { label: string; href: string }) => (
			<li>
				<a href={href}>{label}</a>
			</li>
		),
	});
	return { UserButton };
});

afterEach(cleanup);

describe("the account menu", () => {
	it("leads to Settings and to Billing & upgrade", () => {
		render(<AccountButton />);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/dashboard/settings");
		expect(screen.getByRole("link", { name: "Billing & upgrade" }).getAttribute("href")).toBe("/dashboard/settings#plan");
	});
});
