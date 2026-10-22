import type { OrgSummary } from "./orgs.ts";

export type AppEnv = {
	Bindings: Env;
	Variables: {
		requestId: string;
		userId: string;
		// Set by requireOrg: the signed-in user's company and their role in it.
		org: OrgSummary;
	};
};
