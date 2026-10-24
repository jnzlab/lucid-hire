import type { RubricItem } from "@lucid-hire/scoring";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateList } from "./candidates.ts";
import type { Job } from "./jobs.ts";
import { applyChanges, type RubricChange } from "./rubric.ts";
import { useRubricChanges } from "./use-rubric.ts";

vi.mock("@clerk/react", () => ({
	useAuth: () => ({ isSignedIn: true, userId: "user_1", getToken: async () => "session-token" }),
}));

afterEach(() => vi.unstubAllGlobals());

const jobKey = ["jobs", "user_1", "job_1"];
const listKey = ["candidates", "user_1", "job_1"];
const rubric: RubricItem[] = [
	{ id: "r1", label: "Swift", detail: "Swift in production", weight: "must" },
	{ id: "r2", label: "Kotlin MP", detail: "Code shared with Android", weight: "nice" },
];
// Grace is clear on Swift only, Kenji partial on Swift and clear on Kotlin MP: 75 and 63 with Kotlin MP as Nice,
// 50 and 75 with it as Must.
const row = (id: string, levels: [string, string], score: number, rank: number) => ({
	id,
	name: id,
	fileName: `${id}.pdf`,
	status: "scored",
	scoredBeforeRequirements: false,
	checking: false,
	score,
	rank,
	scoredAt: `2026-10-22T12:00:0${id.length}Z`,
	createdAt: "2026-10-22T12:00:00Z",
	checks: rubric.map(({ id: requirement, label, weight }, index) => ({ id: requirement, label, weight, level: levels[index] })),
	matches: [],
	gaps: [],
});

type Answer = { changes: RubricChange[]; resolve: () => void; reject: () => void };

// A PATCH that waits until the test answers it, so the test sees the page between click and answer.
function setup() {
	const answers: Answer[] = [];
	let serverRubric = rubric;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((resolve) => {
					const { changes } = JSON.parse(String(init?.body)) as { changes: RubricChange[] };
					answers.push({
						changes,
						resolve: () => {
							serverRubric = applyChanges(serverRubric, changes);
							resolve(Response.json({ job: { id: "job_1", rubric: serverRubric, rubricStatus: "ready" } }));
						},
						reject: () => resolve(Response.json({ error: { code: "rubric_not_ready", message: "Not ready." } }, { status: 409 })),
					});
				}),
		),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
	client.setQueryData(jobKey, { id: "job_1", rubric, rubricStatus: "ready" } as Job);
	client.setQueryData(listKey, {
		candidates: [row("grace", ["clear", "none"], 75, 1), row("kenji", ["partial", "clear"], 63, 2)],
		cvCount: 2,
		cvLimit: 10,
	});
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const order = () => client.getQueryData<CandidateList>(listKey)?.candidates.map(({ id, score }) => [id, score]);
	const weight = (id: string) => client.getQueryData<Job>(jobKey)?.rubric?.find((item) => item.id === id)?.weight;
	return { answers, wrapper, order, weight, server: () => serverRubric };
}

describe("useRubricChanges", () => {
	it("re-ranks the cached list before the API answers, and says who moved", async () => {
		const { answers, wrapper, order, weight } = setup();
		const { result } = renderHook(() => useRubricChanges("job_1"), { wrapper });

		let change: ReturnType<ReturnType<typeof useRubricChanges>> | undefined;
		act(() => {
			change = result.current([{ id: "r2", weight: "must" }]);
		});
		expect(weight("r2")).toBe("must");
		expect(order()).toEqual([
			["kenji", 75],
			["grace", 50],
		]);
		expect([...(change?.moves ?? [])]).toEqual([
			["kenji", 1],
			["grace", -1],
		]);

		await waitFor(() => expect(answers).toHaveLength(1));
		expect(answers[0].changes).toEqual([{ id: "r2", weight: "must" }]);
		await act(async () => answers[0].resolve());
		await expect(change?.done).resolves.toBeUndefined();
		expect(weight("r2")).toBe("must");
	});

	it("folds a run of clicks into one more request, so the API ends where the page does", async () => {
		const { answers, wrapper, weight, server } = setup();
		const { result } = renderHook(() => useRubricChanges("job_1"), { wrapper });

		act(() => void result.current([{ id: "r2", weight: "must" }]));
		await waitFor(() => expect(answers).toHaveLength(1));
		// Three more clicks while the first is on its way.
		act(() => void result.current([{ id: "r2", weight: "off" }]));
		act(() => void result.current([{ id: "r1", weight: "nice" }]));
		act(() => void result.current([{ id: "r2", weight: "nice" }]));
		expect([weight("r1"), weight("r2")]).toEqual(["nice", "nice"]);

		await act(async () => answers[0].resolve());
		await waitFor(() => expect(answers).toHaveLength(2));
		expect(answers[1].changes).toEqual([
			{ id: "r2", weight: "nice" },
			{ id: "r1", weight: "nice" },
		]);
		// The first answer (r2 as Must) must not flash back onto the page while the second is on its way.
		expect([weight("r1"), weight("r2")]).toEqual(["nice", "nice"]);

		await act(async () => answers[1].resolve());
		await waitFor(() => expect(server().map(({ weight: w }) => w)).toEqual(["nice", "nice"]));
		expect([weight("r1"), weight("r2")]).toEqual(["nice", "nice"]);
		expect(answers).toHaveLength(2);
	});

	it("doesn't send a run of clicks that ends where it started", async () => {
		const { answers, wrapper, weight } = setup();
		const { result } = renderHook(() => useRubricChanges("job_1"), { wrapper });

		act(() => void result.current([{ id: "r1", weight: "nice" }]));
		await waitFor(() => expect(answers).toHaveLength(1));
		act(() => void result.current([{ id: "r2", weight: "must" }]));
		act(() => void result.current([{ id: "r2", weight: "nice" }]));
		await act(async () => answers[0].resolve());
		await waitFor(() => expect(weight("r1")).toBe("nice"));
		expect(answers).toHaveLength(1);
	});

	it("puts everything back to what the API last confirmed when a request fails, and says so once for the run", async () => {
		const { answers, wrapper, order, weight } = setup();
		const { result } = renderHook(() => useRubricChanges("job_1"), { wrapper });
		const before = order();

		let first: Promise<void> | undefined;
		let second: Promise<void> | undefined;
		act(() => {
			first = result.current([{ id: "r2", weight: "must" }]).done;
		});
		await waitFor(() => expect(answers).toHaveLength(1));
		act(() => {
			second = result.current([{ id: "r1", weight: "off" }]).done;
		});
		const errors = Promise.allSettled([first, second]);

		await act(async () => answers[0].reject());
		const [one, two] = await errors;
		expect(one).toMatchObject({ status: "rejected", reason: { code: "rubric_not_ready" } });
		expect(two.status === "rejected" && one.status === "rejected" && two.reason === one.reason).toBe(true);
		expect([weight("r1"), weight("r2")]).toEqual(["must", "nice"]);
		expect(order()).toEqual(before);
		expect(answers).toHaveLength(1);
	});
});
