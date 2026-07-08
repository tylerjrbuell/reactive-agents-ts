// Run: bun test packages/runtime/tests/withlonghorizon-plumbing.test.ts --timeout 15000
//
// A4 — `.withLongHorizon()` config-plumbing guard. Mirrors the `.withStallPolicy()`
// plumbing: the wither sets an internal flag that flows through to
// `KernelRunOptions.horizonProfile = "long"` (read by the reasoning kernel, A2).
//
//   - PRESENCE: `.withLongHorizon()` → serialized config carries horizonProfile: "long".
//   - DEFAULT-IDENTITY: without the call the field is absent (byte-identical to today).
//   - ROUNDTRIP: config -> builder -> config preserves the flag (declarative parity).
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe(".withLongHorizon() config plumbing", () => {
  test("sets horizonProfile: 'long' on the serialized config", () => {
    const config = ReactiveAgents.create()
      .withName("lh")
      .withProvider("test")
      .withLongHorizon()
      .toConfig();
    expect(config.horizonProfile).toBe("long");
  });

  test("default identity: horizonProfile absent without the call", () => {
    const config = ReactiveAgents.create()
      .withName("lh")
      .withProvider("test")
      .toConfig();
    expect(config.horizonProfile).toBeUndefined();
  });

  test("survives config -> builder -> config roundtrip", async () => {
    const config = ReactiveAgents.create()
      .withName("lh")
      .withProvider("test")
      .withLongHorizon()
      .toConfig();
    const rebuilt = await ReactiveAgents.fromConfig(config);
    expect(rebuilt.toConfig().horizonProfile).toBe("long");
  });
});
