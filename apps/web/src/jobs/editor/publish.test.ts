import { describe, expect, it } from "vitest";
import { savedMessage, statusChoices, submitLabel } from "./publish.ts";
import { DESCRIPTION_MISSING, DESCRIPTION_TOO_LONG, isDirty, tidyInput, validateJob } from "./validate.ts";

describe("statusChoices", () => {
	it("offers Open or Draft for a new job and for a draft", () => {
		expect(statusChoices("new").map((choice) => choice.label)).toEqual(["Open", "Draft"]);
		expect(statusChoices("edit", "draft").map((choice) => choice.label)).toEqual(["Open", "Draft"]);
	});

	it("lets an open job close and a closed one reopen, but never go back to a draft", () => {
		expect(statusChoices("edit", "open").map((choice) => choice.value)).toEqual(["open", "closed"]);
		expect(statusChoices("edit", "closed").map((choice) => choice.value)).toEqual(["open", "closed"]);
	});

	it("says what each status means for candidates", () => {
		expect(statusChoices("new").map((choice) => choice.description)).toEqual([
			"Takes CVs now and the apply page is live.",
			"Only your team can see it.",
		]);
	});
});

describe("submitLabel", () => {
	it("follows the status choice on a new job", () => {
		expect(submitLabel("new", "open")).toBe("Open job");
		expect(submitLabel("new", "draft")).toBe("Save draft");
	});

	it("always saves changes on an edit, whatever the status", () => {
		expect(submitLabel("edit", "open")).toBe("Save changes");
		expect(submitLabel("edit", "closed")).toBe("Save changes");
	});

	it("says Saving while it saves", () => {
		expect(submitLabel("new", "open", true)).toBe("Saving");
		expect(submitLabel("edit", "draft", true)).toBe("Saving");
	});
});

describe("savedMessage", () => {
	it("says whether a new job went live", () => {
		expect(savedMessage("new", "open")).toBe("Job opened. The apply page is live.");
		expect(savedMessage("new", "draft")).toBe("Draft saved. Only your team can see it.");
	});

	it("names a status change made with the edit", () => {
		expect(savedMessage("edit", "open", "open")).toBe("Changes saved");
		expect(savedMessage("edit", "open", "draft")).toBe("Saved and opened. The apply page is live.");
		expect(savedMessage("edit", "open", "closed")).toBe("Saved and reopened. It takes CVs again.");
		expect(savedMessage("edit", "closed", "open")).toBe("Saved and closed. It takes no new CVs.");
	});
});

describe("validateJob", () => {
	it("checks the tidied title and description by the API's rules", () => {
		expect(validateJob(tidyInput({ title: "  Sprite   test role ", description: " Swift " }))).toEqual({});
		expect(validateJob(tidyInput({ title: " a ", description: "" }))).toEqual({
			title: "Enter a job title between 2 and 120 characters",
			description: DESCRIPTION_MISSING,
		});
		expect(validateJob({ title: "x".repeat(121), description: "x".repeat(20_001) })).toEqual({
			title: "Enter a job title between 2 and 120 characters",
			description: DESCRIPTION_TOO_LONG,
		});
	});

	it("collapses the title's spaces and trims the description", () => {
		expect(tidyInput({ title: "  iOS \n Engineer ", description: "\n notes \n" })).toEqual({ title: "iOS Engineer", description: "notes" });
	});
});

describe("isDirty", () => {
	const saved = { title: "Data Scientst", description: "Python" };

	it("is clean when only spaces differ", () => {
		expect(isDirty({ title: " Data   Scientst ", description: "Python\n" }, saved)).toBe(false);
	});

	it("is dirty when the words differ", () => {
		expect(isDirty({ title: "Data Scientist", description: "Python" }, saved)).toBe(true);
		expect(isDirty({ title: "Data Scientst", description: "Python, SQL" }, saved)).toBe(true);
	});
});
