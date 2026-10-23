import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "./api.ts";
import type { Decision } from "./candidates.ts";
import type { JobStatus } from "./jobs.ts";
import { useSession } from "./session.ts";

// What GET /search returns (apps/api/src/search.ts): at most six of each, a title or name starting with the text first.
export type SearchJob = { id: string; title: string; status: JobStatus; cvCount: number };
export type SearchCandidate = {
	id: string;
	jobId: string;
	jobTitle: string;
	// Null until the CV is read: show the file name instead.
	name: string | null;
	fileName: string;
	headline: string | null;
	score: number | null;
	decision: Decision;
};
export type SearchResults = { jobs: SearchJob[]; candidates: SearchCandidate[] };

export const SEARCH_MAX = 100;
// How long typing has to pause before the search goes out.
export const SEARCH_DEBOUNCE_MS = 150;

// The text the API would search for: trimmed, inner whitespace collapsed, at most 100 characters. Blank means no search.
export const searchText = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX).trim();

export const searchKey = (userId: string | null | undefined, text?: string) =>
	(text === undefined ? ["search", userId] : ["search", userId, text]) as readonly unknown[];

// `value`, once it has stopped changing for `ms`.
function useDebounced<T>(value: T, ms: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}

// The command palette's search. Pass what the person typed: it waits SEARCH_DEBOUNCE_MS after the last keystroke,
// cancels the request for the text before, keeps showing the last results while the next arrive, and asks nothing for
// blank text. `isSearching` is true from the keystroke until the results for it are in, for the "Searching" status;
// `searchedFor` is the text `results` belong to.
export function useSearch(raw: string, { debounceMs = SEARCH_DEBOUNCE_MS }: { debounceMs?: number } = {}) {
	const { userId, token } = useSession();
	const typed = searchText(raw);
	const text = useDebounced(typed, debounceMs);
	const query = useQuery({
		queryKey: searchKey(userId, text),
		// The signal is passed on, so a newer search cancels this one. The text rides along, so results shown while the
		// next search loads still say what they were for.
		queryFn: async ({ signal }) => ({
			...(await apiGet<SearchResults>(`/search?q=${encodeURIComponent(text)}`, { token: await token(), signal })),
			q: text,
		}),
		enabled: text.length > 0,
		placeholderData: keepPreviousData,
		staleTime: 30_000,
	});
	const blank = typed.length === 0;
	return {
		results: blank ? undefined : (query.data as SearchResults | undefined),
		searchedFor: blank ? "" : (query.data?.q ?? ""),
		isSearching: !blank && (typed !== text || query.isFetching),
		error: blank ? null : query.error,
		retry: () => void query.refetch(),
	};
}
