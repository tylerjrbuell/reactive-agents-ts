/**
 * HS-116 / Audit R3 — ControllerDecision union coverage guard.
 *
 * After the RI controller census (2026-11-06) the union has 3 variants, each
 * with a registered handler whose effect reaches the run. The census deleted
 * temp-adjust, compress, skill-activate, tool-inject, stall-detect and
 * harness-harm (no effect or never fired); WS-4 Phase 2 (2026-05-28) deleted
 * prompt-switch, memory-boost, skill-reinject and human-escalate.
 *
 * This test catches drift in either direction:
 *   - New variant added to union without handler → fails
 *   - Handler removed from registry → fails
 *
 * When adding a variant: register the handler in handlers/index.ts
 * defaultInterventionRegistry, add the union member to types.ts, then update
 * this test. Never land a variant without a registered handler.
 */
import { describe, it, expect } from "bun:test";
import { defaultInterventionRegistry } from "../../src/controller/handlers/index.js";

/** All declared ControllerDecision tags. */
const ALL_DECISION_TAGS = [
  "early-stop",
  "switch-strategy",
  "tool-failure-redirect",
] as const;

describe("ControllerDecision union — handler coverage guard (HS-116)", () => {
  it("registry has exactly one handler per declared variant", () => {
    expect(defaultInterventionRegistry.length).toBe(ALL_DECISION_TAGS.length);
  });

  it("every declared tag has a registered handler", () => {
    const registered = new Set(defaultInterventionRegistry.map((h) => h.type));
    for (const tag of ALL_DECISION_TAGS) {
      expect(registered.has(tag)).toBe(true);
    }
  });

  it("registry contains no handler outside declared union", () => {
    const declared: ReadonlySet<string> = new Set<string>(ALL_DECISION_TAGS);

    for (const handler of defaultInterventionRegistry) {
      expect(declared.has(handler.type as string)).toBe(true);
    }
  });

  it("registry has unique handler types (no duplicates)", () => {
    const types = defaultInterventionRegistry.map((h) => h.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });
});
