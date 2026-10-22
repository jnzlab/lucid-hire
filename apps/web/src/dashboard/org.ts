import { createContext, use } from "react";
import type { Org } from "../lib/me.ts";

// Provided by the dashboard layout once the recruiter's company has loaded.
export const OrgContext = createContext<Org | null>(null);

// The signed-in recruiter's company and role. Only valid inside the dashboard layout.
export function useOrg(): Org {
	const org = use(OrgContext);
	if (!org) throw new Error("useOrg must be used inside the dashboard layout");
	return org;
}
