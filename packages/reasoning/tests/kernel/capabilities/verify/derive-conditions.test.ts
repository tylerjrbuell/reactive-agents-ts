// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/derive-conditions.test.ts --timeout 15000
//
// deriveConditions(task, requiredTools) — deterministic (NO LLM), conservative.
// Precedence: requiredTools -> ToolCalled(each); a HIGH-PRECISION literal
// deliverable path in the task ("write/create/save/generate a file ./X") ->
// ArtifactProduced('./X') + ToolCalled(<writing tool>). Nothing clear -> EMPTY.
import { describe, it, expect } from "bun:test";
import {
  deriveConditions,
} from "../../../../src/kernel/capabilities/verify/derive-conditions.js";
import {
  toolCalled,
  artifactProduced,
} from "../../../../src/kernel/capabilities/verify/post-conditions.js";

describe("deriveConditions — requiredTools", () => {
  it("derives ToolCalled for each required tool", () => {
    const c = deriveConditions("Search and summarize", ["web-search", "recall"]);
    expect(c).toEqual(
      expect.arrayContaining([toolCalled("web-search"), toolCalled("recall")]),
    );
  }, 15000);
});

describe("deriveConditions — literal deliverable path", () => {
  it("'create a markdown file (./commits.md)' -> ArtifactProduced + writing ToolCalled", () => {
    const c = deriveConditions(
      "Fetch the commits and create a markdown file (./commits.md) summarizing them.",
      ["file-write"],
    );
    expect(c).toEqual(
      expect.arrayContaining([
        artifactProduced("./commits.md"),
        toolCalled("file-write"),
      ]),
    );
  }, 15000);

  it("derives the artifact even with no requiredTools (default writing tool)", () => {
    const c = deriveConditions("write a file ./out.txt with the answer", []);
    expect(c).toEqual(
      expect.arrayContaining([artifactProduced("./out.txt"), toolCalled("file-write")]),
    );
  }, 15000);
});

describe("deriveConditions — conservative (no over-derivation)", () => {
  it("'summarize recursion' -> EMPTY", () => {
    expect(deriveConditions("Summarize the concept of recursion.", [])).toEqual([]);
  }, 15000);

  it("vague 'file' mention without a literal path -> no artifact", () => {
    expect(
      deriveConditions("Tell me about the file system on Linux.", []),
    ).toEqual([]);
  }, 15000);

  it("URL deliverable in parens must NOT derive an ArtifactProduced", () => {
    // Regression: the paren-extract captures `https://example.com` and the
    // PATH_TOKEN strip yields `//example.com`, which the `/https?:/i` guard
    // alone does not catch — it must also be rejected via startsWith("//").
    const c = deriveConditions("save it to (https://example.com/x)", []);
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("is deterministic (same input -> same output)", () => {
    const t = "create a markdown file (./commits.md) summarizing them.";
    expect(deriveConditions(t, ["file-write"])).toEqual(
      deriveConditions(t, ["file-write"]),
    );
  }, 15000);
});

describe("deriveConditions — prose abbreviation precision (no phantom artifact)", () => {
  it("T5 task with '(e.g. AI/ML ...)' must NOT derive an ArtifactProduced", () => {
    // Precision bug: PATH_TOKEN treated the '.g' of 'e.g' as a file extension,
    // yielding a phantom ArtifactProduced('./e.g') for a pure-synthesis task.
    const t =
      "Fetch the top 15 Hacker News posts. Then write a markdown report titled " +
      "'HN Roundup' grouped into 2-4 thematic categories (e.g. AI/ML, Hardware, " +
      "Programming, Other). Summarize each category in 2-3 sentences.";
    const c = deriveConditions(t, []);
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("'see the docs (e.g. the readme)' must NOT derive an ArtifactProduced", () => {
    const c = deriveConditions(
      "Write a summary. See the docs (e.g. the readme) for context.",
      [],
    );
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("'Save the results to data.csv' still derives ArtifactProduced('./data.csv')", () => {
    const c = deriveConditions("Save the results to data.csv", []);
    expect(c).toEqual(
      expect.arrayContaining([
        artifactProduced("./data.csv"),
        toolCalled("file-write"),
      ]),
    );
  }, 15000);
});
