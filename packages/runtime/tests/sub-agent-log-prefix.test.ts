// Run: bun test packages/runtime/tests/sub-agent-log-prefix.test.ts
//
// Sub-agent TUI logging (2026-07-23). The old prefix was a flat "  │ " for every
// child at every depth, so parallel/nested sub-agents collapsed into one
// indistinct, unattributable stream — "difficult to follow." Now each line
// carries one "│ " per nesting level plus the child's name, so a reader can tell
// WHICH child and at what depth every line came from.
import { describe, it, expect } from "bun:test";
import { buildSubAgentLogPrefix } from "../src/builder/build-effect/sub-agent-executor.js";

describe("buildSubAgentLogPrefix", () => {
  it("tags a depth-1 child with a single connector and its name", () => {
    expect(buildSubAgentLogPrefix(1, "researcher")).toBe("  │ researcher · ");
  });

  it("indents deeper with one connector per nesting level", () => {
    expect(buildSubAgentLogPrefix(2, "writer")).toBe("  │ │ writer · ");
    expect(buildSubAgentLogPrefix(3, "editor")).toBe("  │ │ │ editor · ");
  });

  it("distinguishes two children at the same depth by name (parallel case)", () => {
    // The whole point: two parallel children no longer look identical.
    const a = buildSubAgentLogPrefix(1, "search");
    const b = buildSubAgentLogPrefix(1, "summarize");
    expect(a).not.toBe(b);
    expect(a).toContain("search");
    expect(b).toContain("summarize");
  });

  it("never falls below one connector even for a mislabeled depth", () => {
    // Defensive: a depth of 0 or negative still renders a visible child marker
    // rather than an empty prefix that would masquerade as a parent line.
    expect(buildSubAgentLogPrefix(0, "x")).toBe("  │ x · ");
    expect(buildSubAgentLogPrefix(-1, "x")).toBe("  │ x · ");
  });
});
