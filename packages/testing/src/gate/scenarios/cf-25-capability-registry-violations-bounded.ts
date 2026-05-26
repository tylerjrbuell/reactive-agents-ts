// packages/testing/src/gate/scenarios/cf-25-capability-registry-violations-bounded.ts
//
// Targeted weakness: MOVE-2 M2.3 (ablation-warden gate for the Capability
// Cost Registry). Spec
// `wiki/Architecture/Design-Specs/2026-05-26-capability-cost-registry.md`
// §3.4 ships the registry with EXACTLY ONE deliberate violation:
// `strategy-switching` carries `liftEvidence: null` to force
// evidence-gathering or default-revert via this very gate. Without an
// asserted upper bound, a future PR could ship a NEW default-on
// capability with no lift evidence and silently sneak through —
// recreating the Lever-8 leak pattern that the registry was introduced
// to prevent.
//
// This scenario asserts the bootstrap state of the registry — the
// production initial set at L start — meets the gate contract:
//
//   1. EXACTLY ONE entry has `defaultOn && liftEvidence === null` and
//      that entry is `strategy-switching` (the deliberate gap).
//   2. Every other default-on entry has non-null `liftEvidence`.
//   3. Every entry with `liftEvidence` was measured on ≥2 tiers (per
//      ablation-warden pilot cross-tier requirement).
//
// Regression triggered when:
//   - A new default-on entry is registered in bootstrap without lift
//     evidence → violations.length > 1 → scenario fails.
//   - The deliberate strategy-switching violation gets evidence wired
//     → violations.length === 0 → scenario fails (forcing the developer
//     to also update this gate to acknowledge the closed gap).
//   - An existing entry's measuredOn shrinks to < 2 tiers → fails.
//
// Meta-assertion: imports `bootstrapEntries` from the runtime package's
// registry module — production initial state. customAssertions runs the
// invariants directly on that const array (no agent.run() needed; this
// is a pure-data structural gate, not a runtime trace gate).

import { bootstrapEntries } from "@reactive-agents/runtime";
import type { ScenarioModule } from "../types.js";

const EXPECTED_VIOLATOR = "strategy-switching";
const REQUIRED_MEASURED_ON_TIERS = 2;

export const scenario: ScenarioModule = {
  id: "cf-25-capability-registry-violations-bounded",
  targetedWeakness: "MOVE-2/M2.3",
  closingCommit: "MOVE-2-M2.3",
  description:
    "Pins the CapabilityRegistry's load-bearing invariant (master plan MOVE-2 §3.4): exactly ONE bootstrap entry may carry `defaultOn && liftEvidence === null` (the deliberate `strategy-switching` gap), and every entry with lift evidence must have been measured on ≥2 tiers per ablation-warden pilot rules. Without this assertion the registry's primary value proposition — preventing the Lever-8 leak pattern of advertised-but-unverified defaults — silently rots. This scenario does NOT require agent.run(); it asserts structural invariants on the production bootstrap const array.",
  config: {
    name: "cf-25-capability-registry-violations-bounded",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 1,
  },
  customAssertions: () => {
    const violations = bootstrapEntries.filter(
      (e) => e.defaultOn && e.liftEvidence === null,
    );
    const tierGapEntries = bootstrapEntries.filter(
      (e) =>
        e.liftEvidence !== null &&
        e.liftEvidence.measuredOn.length < REQUIRED_MEASURED_ON_TIERS,
    );

    return {
      // Bootstrap shape stability — must be 4 entries today; growing the
      // registry is fine but the count surfaces here so any addition is
      // an explicit gate update.
      "registry.bootstrap.entry_count": bootstrapEntries.length,
      "registry.bootstrap.entry_count_is_4": bootstrapEntries.length === 4,

      // Exactly one deliberate violator.
      "registry.violations.count_is_exactly_1": violations.length === 1,
      "registry.violations.is_strategy_switching":
        violations.length === 1 && violations[0]?.name === EXPECTED_VIOLATOR,

      // Cross-tier coverage on every measured entry.
      "registry.lift_evidence.no_single_tier_entries":
        tierGapEntries.length === 0,
      "registry.lift_evidence.measured_on_count_satisfies_warden_rule":
        bootstrapEntries
          .filter((e) => e.liftEvidence !== null)
          .every(
            (e) =>
              (e.liftEvidence?.measuredOn.length ?? 0) >=
              REQUIRED_MEASURED_ON_TIERS,
          ),

      // Per-entry guards — surface which entry is currently violating
      // (or expected-violating) for diagnostic clarity in baseline diffs.
      "registry.entry.memory.has_evidence":
        bootstrapEntries.find((e) => e.name === "memory")?.liftEvidence !==
        null,
      "registry.entry.reactive_intelligence.has_evidence":
        bootstrapEntries.find((e) => e.name === "reactive-intelligence")
          ?.liftEvidence !== null,
      "registry.entry.verifier.has_evidence":
        bootstrapEntries.find((e) => e.name === "verifier")?.liftEvidence !==
        null,
      "registry.entry.strategy_switching.is_the_deliberate_gap":
        bootstrapEntries.find((e) => e.name === "strategy-switching")
          ?.liftEvidence === null,
    };
  },
};
