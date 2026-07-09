// Run: bun test packages/runtime/tests/withadaptiveharness-plumbing.test.ts --timeout 15000
//
// G1 — `.withAdaptiveHarness()` config-plumbing guard. Mirrors the
// `.withLongHorizon()` plumbing: the wither sets an internal flag that flows
// through to `KernelRunOptions.adaptiveHarness = true`, where runner.ts compiles
// the per-run HarnessPlan.
//
//   - PRESENCE: `.withAdaptiveHarness()` → serialized config carries adaptiveHarness: true.
//   - DEFAULT-IDENTITY: without the call the field is absent (byte-identical to today).
//   - BYTE-IDENTICAL: the ONLY config difference the wither introduces is the
//     adaptiveHarness key — every other key is untouched.
//   - ROUNDTRIP: config -> builder -> config preserves the flag (declarative parity).
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe(".withAdaptiveHarness() config plumbing", () => {
  test("sets adaptiveHarness: true on the serialized config", () => {
    const config = ReactiveAgents.create()
      .withName("ah")
      .withProvider("test")
      .withAdaptiveHarness()
      .toConfig();
    expect(config.adaptiveHarness).toBe(true);
  });

  test("default identity: adaptiveHarness absent without the call", () => {
    const config = ReactiveAgents.create()
      .withName("ah")
      .withProvider("test")
      .toConfig();
    expect(config.adaptiveHarness).toBeUndefined();
  });

  test("byte-identical: the wither changes ONLY the adaptiveHarness key", () => {
    const base = ReactiveAgents.create().withName("ah").withProvider("test").toConfig();
    const adaptive = ReactiveAgents.create()
      .withName("ah")
      .withProvider("test")
      .withAdaptiveHarness()
      .toConfig();
    // Strip the one new key — everything else must be structurally identical.
    const { adaptiveHarness, ...adaptiveRest } = adaptive as Record<string, unknown>;
    expect(adaptiveHarness).toBe(true);
    expect(adaptiveRest).toEqual(base as Record<string, unknown>);
    expect("adaptiveHarness" in (base as Record<string, unknown>)).toBe(false);
  });

  test("survives config -> builder -> config roundtrip", async () => {
    const config = ReactiveAgents.create()
      .withName("ah")
      .withProvider("test")
      .withAdaptiveHarness()
      .toConfig();
    const rebuilt = await ReactiveAgents.fromConfig(config);
    expect(rebuilt.toConfig().adaptiveHarness).toBe(true);
  });
});
