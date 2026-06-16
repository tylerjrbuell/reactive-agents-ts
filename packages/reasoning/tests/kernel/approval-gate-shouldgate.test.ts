// Run: bun test packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts
//
// Durable HITL (Phase D) — the pure gate predicate. The runtime merges all three
// feeders (per-tool requiresApproval flag, builder tools list, builder/compose
// predicate) into the resolved ApprovalGateConfig before this is called, so the
// kernel-side check is just: tool-name set OR predicate.
import { describe, it, expect } from "bun:test";
import { shouldGate } from "../../src/kernel/capabilities/decide/tool-gating.js";

describe("shouldGate", () => {
  it("gates when the resolved tool set contains the name", () => {
    expect(
      shouldGate("file-write", { tools: new Set(["file-write"]) }, { iteration: 1 }),
    ).toBe(true);
  });

  it("gates when the predicate returns true", () => {
    expect(
      shouldGate("web-search", { tools: new Set<string>(), requireFor: () => true }, { iteration: 3 }),
    ).toBe(true);
  });

  it("passes the tool name + iteration to the predicate", () => {
    let seen: { toolName: string; iteration: number } | undefined;
    shouldGate(
      "docker",
      { tools: new Set<string>(), requireFor: (ctx) => { seen = ctx; return false; } },
      { iteration: 7 },
    );
    expect(seen).toEqual({ toolName: "docker", iteration: 7 });
  });

  it("does not gate when neither feeder matches", () => {
    expect(
      shouldGate("web-search", { tools: new Set<string>(), requireFor: () => false }, { iteration: 1 }),
    ).toBe(false);
  });

  it("does not gate with an empty policy", () => {
    expect(shouldGate("anything", { tools: new Set<string>() }, { iteration: 1 })).toBe(false);
  });
});
