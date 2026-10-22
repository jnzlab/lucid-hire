// Sample data and the toy scoring behind the landing page demos. The real scoring reads the whole
// CV; here a must-have counts three times a nice-to-have, as the "Your turn" note says.

export type Weight = 0 | 1 | 3;

export const REQUIREMENTS = [
	{ name: "Swift", detail: "Several years in production", short: "Sw" },
	{ name: "SwiftUI", detail: "Shipped in a live app", short: "UI" },
	{ name: "Performance", detail: "Profiling with Instruments", short: "Pf" },
	{ name: "Accessibility", detail: "VoiceOver, Dynamic Type", short: "A11y" },
	{ name: "GraphQL", detail: "Client side, any library", short: "GQL" },
	{ name: "Kotlin Multiplatform", detail: "Code shared with Android", short: "KMP" },
] as const;

// Evidence per requirement: 1 is clear, 0.5 partial, 0 none. `arrived` breaks ties: earlier first.
export const CANDIDATES = [
	{ name: "Grace Turner", role: "Senior iOS Engineer · London", evidence: [1, 1, 1, 1, 1, 0], arrived: 5 },
	{ name: "Kenji Tanaka", role: "iOS Developer · Tokyo", evidence: [1, 1, 0.5, 0.5, 1, 0], arrived: 2 },
	{ name: "Lucas Becker", role: "Swift Developer · Berlin", evidence: [1, 0.5, 0.5, 0.5, 0, 0], arrived: 1 },
	{ name: "Amelia Nguyen", role: "Mobile Engineer · Melbourne", evidence: [0.5, 0.5, 0, 1, 1, 0], arrived: 3 },
	{ name: "Rayan Al-Farsi", role: "Android Developer · Dubai", evidence: [0, 0, 1, 0.5, 1, 1], arrived: 4 },
	{ name: "Sophia Carter", role: "Frontend Engineer · Toronto", evidence: [0, 0, 0, 1, 0.5, 0], arrived: 0 },
	{ name: "Oliver Hayes", role: "Junior iOS Developer · Dublin", evidence: [0.5, 0.5, 0, 0, 0, 0], arrived: 6 },
] as const;

export const PRESETS = {
	posted: { label: "As posted", weights: [3, 3, 3, 3, 1, 1] },
	android: { label: "Android-leaning", weights: [0, 0, 3, 1, 3, 3] },
	a11y: { label: "Accessibility first", weights: [1, 1, 0, 3, 1, 0] },
} as const satisfies Record<string, { label: string; weights: readonly Weight[] }>;

export type PresetKey = keyof typeof PRESETS;

// Match scores out of 100, or null for everyone when every requirement is off.
export function scoreCandidates(weights: readonly number[]): (number | null)[] {
	const total = weights.reduce((sum, w) => sum + w, 0);
	return CANDIDATES.map(({ evidence }) => {
		if (!total) return null;
		const earned = evidence.reduce<number>((sum, e, k) => sum + (weights[k] ?? 0) * e, 0);
		return Math.round((100 * earned) / total);
	});
}

// Candidate indexes from first to last: highest score first, then whoever applied earlier.
export function rankCandidates(scores: readonly (number | null)[]): number[] {
	return CANDIDATES.map((_, i) => i).sort(
		(a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || CANDIDATES[a].arrived - CANDIDATES[b].arrived,
	);
}

export function matchingPreset(weights: readonly number[]): PresetKey | null {
	for (const [key, preset] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
		if (preset.weights.every((w, k) => w === weights[k])) return key;
	}
	return null;
}

export const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"] as const;

// Pricing: the pile slider's stops and the plan that fits each one.
export const PILE_STOPS = [5, 10, 25, 50, 100, 250, 500, 1000] as const;

export const PLANS = {
	free: { name: "Free", price: "at no cost" },
	pro: { name: "Pro", price: "at $10 a month" },
	max: { name: "Max", price: "at $30 a month" },
} as const;

export type PlanKey = keyof typeof PLANS;

export function planForPile(cvsPerJob: number): PlanKey {
	return cvsPerJob <= 10 ? "free" : cvsPerJob <= 100 ? "pro" : "max";
}

export function formatCount(n: number): string {
	return n >= 1000 ? n.toLocaleString("en-US") : String(n);
}
