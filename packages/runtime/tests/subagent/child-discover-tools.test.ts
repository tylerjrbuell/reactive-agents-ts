// Run: bun test packages/runtime/tests/subagent/child-discover-tools.test.ts --timeout 30000
//
// D-2026-10-29-CHILD-DISCOVER: a tool-less sub-agent child must not be handed
// `discover-tools` (it burned a weak model's whole budget on "No tools
// registered"). Children with real tools keep the parent's options verbatim.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  childHasDiscoverableTools,
  childReasoningOptions,
} from "../../src/builder/build-effect/child-tool-discovery.js";
import { buildLightRuntimeConfig } from "../../src/runtime.js";

const none = { allowedTools: undefined, proxiedToolCount: 0, hasSpawnTools: false };

describe("child discover-tools gate", () => {
  it("tool-less child: not discoverable -> toolDiscovery off, parent harness kept", () => {
    expect(childHasDiscoverableTools(none)).toBe(false);
    expect(childHasDiscoverableTools({ ...none, allowedTools: [] })).toBe(false);
    const out = childReasoningOptions({ harness: { verboseRules: true } }, false);
    expect(out?.harness).toEqual({ verboseRules: true, toolDiscovery: false });
    expect(childReasoningOptions(undefined, false)?.harness).toEqual({ toolDiscovery: false });
  });

  it("child with allowlist / proxied MCP / spawn tools keeps parent options (same reference)", () => {
    const parent = { harness: { toolIndex: true } };
    for (const i of [
      { ...none, allowedTools: ["web-search"] },
      { ...none, proxiedToolCount: 2 },
      { ...none, hasSpawnTools: true },
    ]) {
      expect(childHasDiscoverableTools(i)).toBe(true);
      expect(childReasoningOptions(parent, true)).toBe(parent);
    }
    expect(childReasoningOptions(undefined, true)).toBeUndefined();
  });

  it("reaches the child's resolved light-runtime config", () => {
    const cfg = buildLightRuntimeConfig({
      agentId: "c",
      provider: "test",
      enableReasoning: true,
      enableTools: true,
      reasoningOptions: childReasoningOptions(undefined, false),
    });
    expect(cfg.reasoningOptions?.harness?.toolDiscovery).toBe(false);
  });

  it("executor routes the child through the gate", () => {
    const src = readFileSync(
      new URL("../../src/builder/build-effect/sub-agent-executor.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/reasoningOptions:\s*childReasoning/);
    expect(src).toContain("childHasDiscoverableTools(");
  });
});
