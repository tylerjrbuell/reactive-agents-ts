import { describe, expect, test } from "bun:test";
import { emptyPromptsText, pickerPrompts } from "./prompt-picker.js";
import type { PromptType, StoredPrompt } from "./stores/prompt-store.js";

const p = (id: number, type: PromptType, name = `p${id}`, body = `body ${id}`): StoredPrompt => ({ id, name, body, type, tags: "", createdAt: id, updatedAt: id });

describe("pickerPrompts", () => {
  // Regression: a system-prompt field's picker (system, persona) showed "No saved prompts yet"
  // while the Prompts tab listed prompts saved as Snippet / Task.
  test("the picker never sees zero prompts while the store has some", () => {
    const store = [p(1, "snippet"), p(2, "task")];
    for (const preferred of [[], ["system", "persona"], ["task", "snippet"]] as PromptType[][]) {
      expect(pickerPrompts(store, { preferred })).toHaveLength(2);
    }
  });

  test("preferred types come first, then store order", () => {
    const store = [p(1, "snippet"), p(2, "system"), p(3, "task"), p(4, "persona")];
    expect(pickerPrompts(store, { preferred: ["system", "persona"] }).map((x) => x.id)).toEqual([2, 4, 1, 3]);
  });

  test("a type chip narrows; search matches name or body, case-insensitively", () => {
    const store = [p(1, "snippet", "Greeting", "hello"), p(2, "system", "Tone", "Be brief"), p(3, "system", "Other", "x")];
    expect(pickerPrompts(store, { typeFilter: "system" }).map((x) => x.id)).toEqual([2, 3]);
    expect(pickerPrompts(store, { search: "BRIEF" }).map((x) => x.id)).toEqual([2]);
    expect(pickerPrompts(store, { search: "greet" }).map((x) => x.id)).toEqual([1]);
  });
});

describe("emptyPromptsText", () => {
  test("says 'none yet' only when the store is empty", () => {
    expect(emptyPromptsText(0, 0)).toBe("No saved prompts yet.");
    expect(emptyPromptsText(2, 0)).toContain("No saved prompt matches");
    expect(emptyPromptsText(2, 1)).toBeNull();
  });
});
