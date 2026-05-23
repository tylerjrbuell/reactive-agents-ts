import { describe, test, expect } from "bun:test";
import { parseRationaleBlocks, stripRationaleBlocks } from "../../src/drivers/rationale-parser.js";

// HS-cleanup-1 (2026-05-23) — producer-side root-fix invariants.
//
// The model is instructed to emit `<rationale call="N">{...}</rationale>`
// blocks in its assistant text alongside tool calls. After
// `parseRationaleBlocks` extracts the structured data, the raw XML must NOT
// remain in the text stored in `state.steps[].content` (it would re-enter
// the model's next-turn context AND surface as user output when no tool call
// follows). `stripRationaleBlocks` is the producer-side strip; this test
// covers its invariants.

describe("stripRationaleBlocks — canonical producer-side strip", () => {
  test("strips paired wrapper, returns empty on body-only input", () => {
    const text = '<rationale call="1">{"why":"x"}</rationale>';
    expect(stripRationaleBlocks(text)).toBe("");
  });

  test("strips wrapper, preserves trailing answer", () => {
    const text = '<rationale call="1">{"why":"x"}</rationale>\nThe result is 391.';
    const out = stripRationaleBlocks(text);
    expect(out).not.toContain("<rationale");
    expect(out).toContain("The result is 391.");
  });

  test("strips multiple wrappers, preserves interleaved prose", () => {
    const text =
      '<rationale call="1">{"why":"first"}</rationale>\n' +
      "Mid prose.\n" +
      '<rationale call="2">{"why":"second"}</rationale>\n' +
      "End.";
    const out = stripRationaleBlocks(text);
    expect(out).not.toContain("<rationale");
    expect(out).toContain("Mid prose.");
    expect(out).toContain("End.");
  });

  test("strips orphan closing `</rationale>` tag (partial-stream defense)", () => {
    const text = "Mid-stream cut.\n</rationale>";
    const out = stripRationaleBlocks(text);
    expect(out).not.toContain("</rationale>");
    expect(out).toContain("Mid-stream cut.");
  });

  test("strips orphan opening tag (truncated stream)", () => {
    const text = 'partial output <rationale call="1">{"why":"truncated';
    const out = stripRationaleBlocks(text);
    expect(out).not.toContain("<rationale");
    expect(out).toContain("partial output");
  });

  test("does NOT touch unrelated XML-like prose", () => {
    const text = "The XML format <other tag>...</other tag> stays untouched.";
    expect(stripRationaleBlocks(text)).toBe(text);
  });

  test("idempotent", () => {
    const text = '<rationale call="1">{"why":"x"}</rationale>\nAnswer.';
    const once = stripRationaleBlocks(text);
    const twice = stripRationaleBlocks(once);
    expect(twice).toBe(once);
  });

  test("handles empty input", () => {
    expect(stripRationaleBlocks("")).toBe("");
  });

  test("parser still extracts structured data from the SAME text", () => {
    // parseRationaleBlocks runs BEFORE stripRationaleBlocks in think.ts.
    // Confirm parsing works on a raw blob that the strip step would later clean.
    const text =
      '<rationale call="1">{"why":"reason one","confidence":0.9}</rationale>\n' +
      '<rationale call="2">{"why":"reason two","confidence":0.8}</rationale>';
    const blocks = parseRationaleBlocks(text);
    expect(blocks.size).toBe(2);
    expect(blocks.get(1)?.why).toBe("reason one");
    expect(blocks.get(2)?.why).toBe("reason two");

    // And the same text post-strip carries none of the wrapper markup.
    const stripped = stripRationaleBlocks(text);
    expect(stripped).not.toContain("<rationale");
    expect(stripped).not.toContain("</rationale>");
  });
});
