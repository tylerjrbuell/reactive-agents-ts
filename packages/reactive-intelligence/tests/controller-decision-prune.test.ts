// Run: bun test packages/reactive-intelligence/tests/controller-decision-prune.test.ts --timeout 15000
//
// WS-4 Phase 2 prune (master plan §3.6 RC-3 / anti-mission #6):
//
// Anti-scaffold law (architecture model §9, North Star §9): scaffolded
// surfaces without registered callers/handlers SHOULD NOT remain in the
// public type union. The 4 ⚠ UNWIRED ControllerDecision variants
// (prompt-switch, memory-boost, skill-reinject, human-escalate) had
// evaluator files but no registered handler in defaultInterventionRegistry
// — the dispatcher would always reject them with `no-handler`. They are
// pruned wholesale: union members removed from types.ts, evaluator files
// deleted, dispatcher bridge case dropped.
//
// This test pins the prune so the variants cannot silently return without
// shipping a handler+wiring (which the master plan requires before any
// re-introduction).

import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PRUNED_VARIANTS = [
  "prompt-switch",
  "memory-boost",
  "skill-reinject",
  "human-escalate",
] as const;

const TYPES_PATH = resolve(
  import.meta.dir,
  "../src/types.ts",
);

const EVALUATORS_DIR = resolve(
  import.meta.dir,
  "../src/controller/evaluators",
);

describe("WS-4 Phase 2 — ControllerDecision union prune", () => {
  const typesSource = readFileSync(TYPES_PATH, "utf-8");

  for (const variant of PRUNED_VARIANTS) {
    it(`union literal "decision: \\"${variant}\\"" is ABSENT from types.ts`, () => {
      // Look for the exact union-member discriminator pattern.
      // The previous comment block ("⚠ UNWIRED — evaluator exists...") would
      // also count as a reference; we ban both the JSDoc note and the literal.
      const literalPattern = `decision: "${variant}"`;
      expect(typesSource).not.toContain(literalPattern);
    }, 15000);
  }

  for (const variant of PRUNED_VARIANTS) {
    it(`evaluator file evaluators/${variant}.ts does NOT exist`, () => {
      const evalPath = resolve(EVALUATORS_DIR, `${variant}.ts`);
      expect(existsSync(evalPath)).toBe(false);
    }, 15000);
  }

  it("types.ts no longer carries the ⚠ UNWIRED disposition tag for these variants", () => {
    // The audit JSDoc explicitly used "⚠ UNWIRED" to mark these. After
    // prune, no variant should still carry that tag (the 4 UNWIRED ones
    // are gone; the remaining 9 are ACTIVE or 🟡 UNFIRED only).
    expect(typesSource).not.toContain("⚠ UNWIRED");
  }, 15000);
});
