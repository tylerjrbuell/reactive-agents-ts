/**
 * Behavioral contract tests for tool result compression.
 *
 * compressToolResult() lives in @reactive-agents/reasoning's internal
 * tool-utils module. It is re-exported from the reactive strategy file but
 * is NOT part of @reactive-agents/reasoning's public index. Tests import
 * from the source path directly.
 *
 * BUG NOTE: compressToolResult is not exported from the public
 * @reactive-agents/reasoning package index. If it should be a public API,
 * it should be added to packages/reasoning/src/index.ts.
 * For now we import from the internal strategy source path.
 */
import { describe, it, expect } from "bun:test";
import {
  compressToolResult,
} from "../../reasoning/src/strategies/kernel/utils/tool-formatting.js";

const BUDGET = 200;
const PREVIEW_ITEMS = 3;

describe("compressToolResult", () => {
  // ─── Test 1: Short result passes through unchanged ────────────────────────

  it("short result under budget passes through unchanged", () => {
    const shortResult = '{"items":[1,2,3],"total":3}';
    expect(shortResult.length).toBeLessThan(BUDGET);

    const compressed = compressToolResult(shortResult, "my-tool", BUDGET, PREVIEW_ITEMS);

    // Content should be identical — no modification
    expect(compressed.content).toBe(shortResult);
    // No overflow to scratchpad
    expect(compressed.stored).toBeUndefined();
  });

  // ─── Test 2: Long result is truncated to budget ───────────────────────────

  it("long plain text result is truncated and does not exceed budget characters", () => {
    const longText = "x".repeat(2000);
    expect(longText.length).toBeGreaterThan(BUDGET);

    const compressed = compressToolResult(longText, "my-tool", BUDGET, PREVIEW_ITEMS);

    // The compressed content must be shorter than the original
    expect(compressed.content.length).toBeLessThan(longText.length);
    // Stored key must be present (overflow stored in scratchpad)
    expect(compressed.stored).toBeDefined();
    expect(compressed.stored!.key).toMatch(/^_tool_result_\d+$/);
    expect(compressed.stored!.value).toBe(longText);
  });

  // ─── Test 3: JSON array result gets structured preview ────────────────────

  it("large JSON array produces a structured preview capped at previewItems", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const jsonArray = JSON.stringify(items);
    expect(jsonArray.length).toBeGreaterThan(BUDGET);

    const compressed = compressToolResult(jsonArray, "list-tool", BUDGET, PREVIEW_ITEMS);

    // Content should describe it as an array
    expect(compressed.content).toContain("Array(100)");
    // Preview should show at most PREVIEW_ITEMS entries (indices 0, 1, 2)
    expect(compressed.content).toContain("[0]");
    expect(compressed.content).toContain("[1]");
    expect(compressed.content).toContain("[2]");
    // Index 3 should NOT appear in the preview (it's beyond previewItems)
    expect(compressed.content).not.toContain("[3]");
    // Overflow must be stored
    expect(compressed.stored).toBeDefined();
  });

  // ─── Test 4: JSON object result gets a key/value preview ─────────────────

  it("large JSON object produces a key-based preview", () => {
    const bigObject = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`key_${i}`, `value_${"v".repeat(30)}_${i}`]),
    );
    const jsonObj = JSON.stringify(bigObject);
    expect(jsonObj.length).toBeGreaterThan(BUDGET);

    const compressed = compressToolResult(jsonObj, "obj-tool", BUDGET, PREVIEW_ITEMS);

    // Should describe it as an Object
    expect(compressed.content).toContain("Object(50 keys)");
    // At least a few keys should appear
    expect(compressed.content).toContain("key_0");
    // Overflow must be stored
    expect(compressed.stored).toBeDefined();
    // The full JSON must be in the stored value
    expect(compressed.stored!.value).toBe(jsonObj);
  });

  // ─── Test 5: Plain text result is truncated with storage hint ─────────────

  it("long plain text result is stored with scratchpad reference in content", () => {
    // Multi-line text that is definitely over budget
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: ${"a".repeat(40)}`);
    const longText = lines.join("\n");
    expect(longText.length).toBeGreaterThan(BUDGET);

    const compressed = compressToolResult(longText, "text-tool", BUDGET, PREVIEW_ITEMS);

    // Content should NOT be the original text
    expect(compressed.content).not.toBe(longText);
    // The stored key must be referenced in the content
    expect(compressed.stored).toBeDefined();
    const key = compressed.stored!.key;
    expect(compressed.content).toContain(key);
    // Should contain a recall hint
    expect(compressed.content).toContain("recall(");
    // The first few lines should appear in the preview
    expect(compressed.content).toContain("Line 1:");
  });
});
