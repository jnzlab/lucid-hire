import { formatNumber } from "../lib/format.ts";

// "1 CV" / "3 CVs", with the number formatted the app's way.
export const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;
