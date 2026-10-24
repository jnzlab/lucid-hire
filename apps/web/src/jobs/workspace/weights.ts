import type { Weight } from "@lucid-hire/scoring";
import { WEIGHT_LABEL } from "../../lib/rubric.ts";
import type { Segment } from "../../ui/segmented-control.tsx";

// Must is filled in ink and Nice sits on the marker, so the strength of each choice shows at a glance; the words say
// it too. Off is the plain chosen segment.
export const WEIGHT_SEGMENTS: Segment<Weight>[] = [
	{ value: "must", label: WEIGHT_LABEL.must, mark: "ink" },
	{ value: "nice", label: WEIGHT_LABEL.nice, mark: "marker" },
	{ value: "off", label: WEIGHT_LABEL.off },
];
