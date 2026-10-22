import { UserButton } from "@clerk/react";
import { Card, Gear } from "../components/icons.tsx";

// Clerk's account menu, with the way to the settings page and to the plans added to it.
export function AccountButton() {
	return (
		<UserButton>
			<UserButton.MenuItems>
				<UserButton.Link label="Settings" labelIcon={<Gear />} href="/dashboard/settings" />
				<UserButton.Link label="Billing & upgrade" labelIcon={<Card />} href="/dashboard/settings#plan" />
			</UserButton.MenuItems>
		</UserButton>
	);
}
