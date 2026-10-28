import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./types/agent-config.js";
import { effectiveToolsEnabled, hasToolSelection, toggleServerTools } from "./tool-selection.js";

describe("tool selection → tools enabled", () => {
  test("a selection enables tools unless explicitly switched off; explicit on works with none", () => {
    const withTools = { ...defaultConfig(), tools: ["web-search"] };
    const none = { ...defaultConfig(), tools: [] };
    expect(hasToolSelection(withTools)).toBe(true);
    expect(effectiveToolsEnabled(withTools, undefined)).toBe(true);
    expect(effectiveToolsEnabled(withTools, false)).toBe(false);
    expect(effectiveToolsEnabled(none, undefined)).toBe(false);
    expect(effectiveToolsEnabled(none, true)).toBe(true);
    expect(effectiveToolsEnabled({ ...none, mcpServerIds: ["m"] }, undefined)).toBe(true);
  });
});

describe("toggleServerTools", () => {
  const server = ["a", "b", "c"];
  test("selects every tool of the server when not all are selected, keeping other selections", () => {
    expect(toggleServerTools(["x", "a"], server)).toEqual(["x", "a", "b", "c"]);
  });
  test("clears the whole server when all are selected, keeping other selections", () => {
    expect(toggleServerTools(["x", "a", "b", "c"], server)).toEqual(["x"]);
  });
  test("a server with no cached tools is a no-op", () => {
    expect(toggleServerTools(["x"], [])).toEqual(["x"]);
  });
});
