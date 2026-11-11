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
      shouldGate("file-write", { tools: new Set(["file-write"]) }, { iteration: 1, args: {} }),
    ).toBe(true);
  });

  it("gates when the predicate returns true", () => {
    expect(
      shouldGate("web-search", { tools: new Set<string>(), requireFor: () => true }, { iteration: 3, args: {} }),
    ).toBe(true);
  });

  it("passes the tool name + iteration + args to the predicate", () => {
    let seen: { toolName: string; iteration: number; args: unknown } | undefined;
    shouldGate(
      "docker",
      { tools: new Set<string>(), requireFor: (ctx) => { seen = ctx; return false; } },
      { iteration: 7, args: { image: "alpine" } },
    );
    expect(seen).toEqual({ toolName: "docker", iteration: 7, args: { image: "alpine" } });
  });

  it("does not gate when neither feeder matches", () => {
    expect(
      shouldGate("web-search", { tools: new Set<string>(), requireFor: () => false }, { iteration: 1, args: {} }),
    ).toBe(false);
  });

  it("does not gate with an empty policy", () => {
    expect(shouldGate("anything", { tools: new Set<string>() }, { iteration: 1, args: {} })).toBe(false);
  });
});

// Command rules: users pick which shell commands need approval, not only which
// tools. The read-only git/gh shell RUNS a rule-matched write, so the gate must
// match exactly the same calls (one matcher, @reactive-agents/tools).
describe("shouldGate — shell command rules", () => {
  const policy = { tools: new Set<string>(), commands: ["git push"] as const };

  it("gates a shell tool call whose command matches a rule", () => {
    expect(shouldGate("git-cli", policy, { iteration: 1, args: { command: "git push origin main" } })).toBe(true);
    expect(shouldGate("shell-execute", policy, { iteration: 1, args: { command: "git status && git push" } })).toBe(true);
  });

  it("does not gate a shell command no rule names", () => {
    expect(shouldGate("git-cli", policy, { iteration: 1, args: { command: "git status" } })).toBe(false);
  });

  it("does not gate a non-shell tool even when its args carry a matching command", () => {
    expect(shouldGate("file-write", policy, { iteration: 1, args: { command: "git push" } })).toBe(false);
  });

  it("does not gate when args are not an object", () => {
    expect(shouldGate("git-cli", policy, { iteration: 1, args: "git push" })).toBe(false);
    expect(shouldGate("git-cli", policy, { iteration: 1, args: undefined })).toBe(false);
  });
});
