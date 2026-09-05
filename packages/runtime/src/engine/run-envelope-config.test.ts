// run-envelope-config.test.ts — pins F-4 (2026-08-24 amendment, re-opened
// 2026-09-03 architecture audit): a ContextProfile tier's `toolDisclosureMode`
// must reach `resolveHarnessConfig` and change the resolved harness. Before
// this fix, `fromDisclosureMode()` was exported and unit-tested in isolation
// but had zero production callers — every tier's disclosure preset was inert.
//
// Cutting the `disclosureFloor(config)` call from `buildRunEnvelopeFromConfig`
// turns every assertion below red except the "explicit harness wins" case.
import { describe, it, expect } from "bun:test";
import { buildRunEnvelopeFromConfig } from "./run-envelope-config.js";
import { defaultReactiveAgentsConfig } from "../types.js";
import type { ReactiveAgentsConfig } from "../types.js";

const withProfile = (patch: Partial<ReactiveAgentsConfig>): ReactiveAgentsConfig =>
  defaultReactiveAgentsConfig("test-agent", patch);

describe("buildRunEnvelopeFromConfig — disclosure-mode floor (F-4)", () => {
  it("no explicit profile, no ollama provider ⇒ mid tier's hybrid mode resolves", () => {
    const envelope = buildRunEnvelopeFromConfig(withProfile({}));
    expect(envelope.harness.lazyDisclosure).toBe(true);
    expect(envelope.harness.toolDiscovery).toBe(true);
    expect(envelope.harness.toolIndex).toBe(true);
  });

  it("ollama provider, no explicit tier ⇒ local tier's index mode resolves", () => {
    const envelope = buildRunEnvelopeFromConfig(withProfile({ provider: "ollama" }));
    expect(envelope.harness.lazyDisclosure).toBe(true);
    expect(envelope.harness.toolDiscovery).toBe(false);
    expect(envelope.harness.toolIndex).toBe(true);
  });

  it("explicit contextProfile.toolDisclosureMode overrides the tier default", () => {
    const envelope = buildRunEnvelopeFromConfig(
      withProfile({ contextProfile: { toolDisclosureMode: "full" } }),
    );
    expect(envelope.harness.lazyDisclosure).toBe(false);
    expect(envelope.harness.toolDiscovery).toBe(false);
    expect(envelope.harness.toolIndex).toBe(false);
  });

  it("explicit reasoningOptions.harness field wins over the profile floor", () => {
    const envelope = buildRunEnvelopeFromConfig(
      withProfile({
        contextProfile: { toolDisclosureMode: "hybrid" }, // would set toolIndex: true
        reasoningOptions: { harness: { toolIndex: false } },
      }),
    );
    expect(envelope.harness.toolIndex).toBe(false);
    // Fields the explicit config didn't touch still come from the floor.
    expect(envelope.harness.toolDiscovery).toBe(true);
  });

  it("an explicit RA_LAZY_TOOLS env var still wins over the profile floor", () => {
    const saved = process.env["RA_LAZY_TOOLS"];
    process.env["RA_LAZY_TOOLS"] = "0";
    try {
      // mid tier's "hybrid" floor wants lazyDisclosure: true — env must win.
      const envelope = buildRunEnvelopeFromConfig(withProfile({}));
      expect(envelope.harness.lazyDisclosure).toBe(false);
    } finally {
      if (saved === undefined) delete process.env["RA_LAZY_TOOLS"];
      else process.env["RA_LAZY_TOOLS"] = saved;
    }
  });
});
