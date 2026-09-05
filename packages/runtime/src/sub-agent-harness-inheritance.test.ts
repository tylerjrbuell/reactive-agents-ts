// Run: bun test packages/runtime/src/sub-agent-harness-inheritance.test.ts
//
// Sub-agent harness inheritance (2026-08-27, Task 6). Unlike the other
// cross-cutting fields pinned by `sub-agent-light-config.test.ts`
// (taskContract / fabricationGuard / grounding / approvalPolicy), harness
// config needs NO new `parentHarness` carrier. Task 4's `.withHarness()`
// overload writes into the EXISTING `this._reasoningOptions` builder field
// (`this._reasoningOptions = { ...this._reasoningOptions, harness: {...} }`),
// and `_reasoningOptions` is already captured verbatim as
// `parentReasoningOptions` and forwarded into the child's
// `createLightRuntime` call in `sub-agent-executor.ts`. The whole-object
// passthrough is structural and unconditional — it is not a per-field gate
// target, which is why check 5/12 of `check-cross-cutting.sh` does NOT list
// `harness` among its inherited-field pairs.
//
// These tests pin (a) the structural wiring in sub-agent-executor.ts that
// makes the passthrough true, and (b) the behavioral consequence: a harness
// value set via `.withHarness()` on a parent's `_reasoningOptions` shape
// survives verbatim into a child's resolved config, the same path
// `sub-agent-light-config.test.ts` uses for the other inherited fields.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { buildLightRuntimeConfig } from "./runtime.js";
import { ReactiveAgents } from "./index.js";

describe("sub-agents inherit the parent's harness config (structural)", () => {
  const src = readFileSync(
    "packages/runtime/src/builder/build-effect/sub-agent-executor.ts",
    "utf8",
  );

  it("declares parentReasoningOptions on the deps record (the real carrier — NOT a new parentHarness field)", () => {
    expect(src).toContain("parentReasoningOptions");
    // The brief's literal `parentHarness` proposal is superseded; guard
    // against it being reintroduced as a redundant, easily-desynced field.
    expect(src).not.toContain("parentHarness");
  });

  it("forwards parentReasoningOptions verbatim into the child's reasoning options", () => {
    expect(src).toMatch(/reasoningOptions:\s*parentReasoningOptions/);
  });
});

describe("sub-agents inherit the parent's harness config (behavioral)", () => {
  it("a harness value set via .withHarness() is visible on a child's resolved (light runtime) config", () => {
    // Mirror what builder.ts does at the spawn seam: capture the parent's
    // `_reasoningOptions` (which `.withHarness()` writes `harness` into) and
    // hand it to the SAME `buildLightRuntimeConfig` helper that constructs a
    // sub-agent's config in `createLightRuntime`. `.toConfig()` is the public
    // surface for reading back what `.withHarness()` recorded (no reach into
    // the private `_reasoningOptions` field, no `as unknown as` cast).
    const parent = ReactiveAgents.create()
      .withName("parent")
      .withProvider("test")
      .withModel("test-model")
      .withHarness({ verboseRules: true, toolIndex: true });
    const parentHarness = parent.toConfig().reasoning?.harness;

    expect(parentHarness).toEqual({
      verboseRules: true,
      toolIndex: true,
    });

    const childConfig = buildLightRuntimeConfig({
      agentId: "child-1",
      provider: "test",
      reasoningOptions: { harness: parentHarness },
    });

    expect(childConfig.reasoningOptions?.harness).toEqual({
      verboseRules: true,
      toolIndex: true,
    });
  });

  it("omits the harness field when the parent set none (no accidental default injection)", () => {
    const childConfig = buildLightRuntimeConfig({
      agentId: "child-2",
      provider: "test",
    });
    expect(childConfig.reasoningOptions?.harness).toBeUndefined();
  });
});
