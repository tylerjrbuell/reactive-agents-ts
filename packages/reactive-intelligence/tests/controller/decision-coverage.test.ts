/**
 * HS-116 / Audit R3 — ControllerDecision union coverage guard.
 *
 * After WS-4 Phase 2 prune (2026-05-28, master plan §3.6 RC-3) the union
 * has 9 declared variants:
 *   - 5 ACTIVE: handler registered + corpus-confirmed firing
 *   - 4 UNFIRED: handler registered, corpus expansion needed
 *
 * The previous 4 ⚠ UNWIRED variants (prompt-switch, memory-boost,
 * skill-reinject, human-escalate) were deleted entirely — evaluators
 * gone, union members gone.
 *
 * This test catches drift in either direction:
 *   - New variant added to union without handler → fails
 *   - Handler removed from registry → fails
 *
 * Source-of-truth for state classifications: types.ts ControllerDecision
 * JSDoc tags (✅ ACTIVE / 🟡 UNFIRED).
 *
 * When promoting an UNFIRED variant to ACTIVE: extend the failure-corpus
 * probe + verify firing in trace, then update both this test and the
 * union JSDoc.
 *
 * When re-introducing a variant that was pruned in WS-4 Phase 2: register
 * the handler in handlers/index.ts defaultInterventionRegistry, add the
 * union member to types.ts, then update this test + union JSDoc. Never
 * land a variant without a registered handler (anti-mission #6 /
 * North Star §9 — no scaffold without callers).
 */
import { describe, it, expect } from "bun:test";
import { defaultInterventionRegistry } from "../../src/controller/handlers/index.js";

/** All 9 declared ControllerDecision tags (post WS-4 Phase 2 prune). */
const ALL_DECISION_TAGS = [
  "early-stop",
  "compress",
  "switch-strategy",
  "temp-adjust",
  "skill-activate",
  "tool-inject",
  "tool-failure-redirect",
  "stall-detect",
  "harness-harm",
] as const;

describe("ControllerDecision union — handler coverage guard (HS-116 / WS-4 Phase 2)", () => {
  it("registry has exactly 9 handlers (one per declared variant)", () => {
    expect(defaultInterventionRegistry.length).toBe(9);
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
