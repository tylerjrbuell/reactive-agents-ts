import { describe, it, expect } from "bun:test";
import { isSubagentCall, SUBAGENT_TOOL_NAMES } from "../src/subagent-telemetry.js";

describe("isSubagentCall", () => {
  it("recognizes spawn-agent and spawn-agents as builtin subagent tools", () => {
    expect(isSubagentCall("spawn-agent", [])).toBe(true);
    expect(isSubagentCall("spawn-agents", [])).toBe(true);
  });

  it("recognizes user-registered agent tools by name", () => {
    expect(isSubagentCall("research-assistant", ["research-assistant"])).toBe(true);
    expect(isSubagentCall("code-reviewer", ["code-reviewer", "qa-checker"])).toBe(true);
  });

  it("returns false for non-agent tools", () => {
    expect(isSubagentCall("web-search", [])).toBe(false);
    expect(isSubagentCall("file-write", ["research-assistant"])).toBe(false);
  });

  it("exports the builtin set with exactly 2 entries", () => {
    expect(SUBAGENT_TOOL_NAMES.size).toBe(2);
    expect(SUBAGENT_TOOL_NAMES.has("spawn-agent")).toBe(true);
    expect(SUBAGENT_TOOL_NAMES.has("spawn-agents")).toBe(true);
  });
});
