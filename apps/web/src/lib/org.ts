import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPatch } from "./api.ts";
import { type Me, type Org, meQueryKey } from "./me.ts";
import { useSession } from "./session.ts";

// The same bounds and clean-up the API applies to a company name (apps/api/src/orgs.ts).
export const ORG_NAME_MIN = 2;
export const ORG_NAME_MAX = 80;
export const ORG_NAME_HINT = `Enter a company name between ${ORG_NAME_MIN} and ${ORG_NAME_MAX} characters`;

// The name as the API would store it (trimmed, inner whitespace collapsed), or null when it is too short or too long.
export function cleanOrgName(raw: string): string | null {
	const name = raw.trim().replace(/\s+/g, " ");
	return name.length >= ORG_NAME_MIN && name.length <= ORG_NAME_MAX ? name : null;
}

// Renames the company (admins only; the API answers 403 for members). The cached account takes the new name, so the
// sidebar and every page that shows it change at once.
export function useRenameOrg() {
	const { userId, token } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (name: string) =>
			(await apiPatch<{ org: Org }>("/orgs/current", { name }, { token: await token() })).org,
		onSuccess: (org) => queryClient.setQueryData<Me>(meQueryKey(userId), (me) => me && { ...me, org }),
	});
}
