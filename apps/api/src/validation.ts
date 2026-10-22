import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";

// Zod failures in the API's error shape: the first message, plus the first message for each field.
export function validJson<T extends z.ZodType>(schema: T) {
	return zValidator("json", schema, (result, c) => {
		if (result.success) return;
		const fields: Record<string, string> = {};
		for (const issue of result.error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
		return c.json(
			{ error: { code: "invalid_input", message: result.error.issues[0]?.message ?? "Check the form", fields } },
			400,
		);
	});
}
