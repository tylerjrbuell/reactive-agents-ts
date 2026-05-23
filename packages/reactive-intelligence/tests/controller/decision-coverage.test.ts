/**
 * HS-116 / Audit R3 — ControllerDecision union coverage guard.
 *
 * Pins the current state of the 13 declared union variants:
 *   - 5 ACTIVE: handler registered + corpus-confirmed firing
 *   - 4 UNFIRED: handler registered, corpus expansion needed
 *   - 4 UNWIRED: evaluator exists, NO handler registered
 *
 * This test catches drift in either direction:
 *   - New variant added to union without handler → fails
 *   - Handler removed from registry → fails
 *
 * Source-of-truth for state classifications: types.ts ControllerDecision
 * JSDoc tags (✅ ACTIVE / 🟡 UNFIRED / ⚠ UNWIRED).
 *
 * When promoting an UNFIRED variant to ACTIVE: extend the failure-corpus
 * probe + verify firing in trace, then update both this test and the
 * union JSDoc.
 *
 * When promoting an UNWIRED variant to ACTIVE: register the handler in
 * handlers/index.ts defaultInterventionRegistry, then update this test
 * + union JSDoc.
 */
import { describe, it, expect } from "bun:test";
import { defaultInterventionRegistry } from "../../src/controller/handlers/index.js";

/** All 13 declared ControllerDecision tags. */
const ALL_DECISION_TAGS = [
  "early-stop",
  "compress",
  "switch-strategy",
  "temp-adjust",
  "skill-activate",
  "prompt-switch",
  "tool-inject",
  "tool-failure-redirect",
  "memory-boost",
  "skill-reinject",
  "human-escalate",
  "stall-detect",
  "harness-harm",
] as const;

/**
 * Variants WITHOUT a registered handler. Decision objects of these types
 * will never reach a handler at runtime — the dispatcher rejects with
 * `no-handler` reason. Either register the handler in handlers/index.ts
 * OR delete the variant + evaluator.
 */
const UNWIRED_TAGS = new Set([
  "prompt-switch",
  "memory-boost",
  "skill-reinject",
  "human-escalate",
]);

describe("ControllerDecision union — handler coverage guard (HS-116)", () => {
  it("registry has exactly 9 handlers (13 declared − 4 unwired)", () => {
    expect(defaultInterventionRegistry.length).toBe(9);
  });

  it("every ACTIVE / UNFIRED tag has a registered handler", () => {
    const registered = new Set(defaultInterventionRegistry.map((h) => h.type));
    const wiredExpected = ALL_DECISION_TAGS.filter((t) => !UNWIRED_TAGS.has(t));

    for (const tag of wiredExpected) {
      expect(registered.has(tag)).toBe(true);
    }
  });

  it("every UNWIRED tag has NO registered handler (anti-scaffold tracking)", () => {
    const registered: ReadonlySet<string> = new Set<string>(
      defaultInterventionRegistry.map((h) => h.type as string),
    );

    for (const tag of UNWIRED_TAGS) {
      expect(registered.has(tag)).toBe(false);
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
