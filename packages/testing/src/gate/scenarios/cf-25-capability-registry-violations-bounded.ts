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
// 2026-11-05: the deliberate gap is CLOSED. Strategy switching was ablated
// (wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md, gate
// verdict OPT-IN: no lift at +28% billed tokens) and moved to
// `defaultOn: false` with its evidence recorded. The gate now asserts:
//
//   1. NO entry has `defaultOn && liftEvidence === null`.
//   2. Every DEFAULT-ON entry's evidence was measured on ≥2 tiers (the
//      ablation-warden cross-tier rule governs default-on claims; an
//      opt-in demotion may rest on one tier).
//   3. `strategy-switching` is opt-in and carries its evidence.
//
// Regression triggered when:
//   - A default-on entry is registered without lift evidence → fails.
//   - A default-on entry's measuredOn shrinks to < 2 tiers → fails.
//   - Strategy switching returns to default-on, or loses its evidence,
//     without this gate being updated (Plan 9 item 2g owns that path).
//
// Meta-assertion: imports `bootstrapEntries` from the runtime package's
// registry module — production initial state. customAssertions runs the
// invariants directly on that const array (no agent.run() needed; this
// is a pure-data structural gate, not a runtime trace gate).

import { bootstrapEntries } from "@reactive-agents/runtime";
import type { ScenarioModule } from "../types.js";

const REQUIRED_MEASURED_ON_TIERS = 2;

export const scenario: ScenarioModule = {
  id: "cf-25-capability-registry-violations-bounded",
  targetedWeakness: "MOVE-2/M2.3",
  closingCommit: "MOVE-2-M2.3",
  description:
    "Pins the CapabilityRegistry's load-bearing invariant (master plan MOVE-2 §3.4): no bootstrap entry may be default-on without lift evidence, and every default-on entry's evidence must have been measured on ≥2 tiers per ablation-warden rules. The former deliberate gap (`strategy-switching`) is closed: ablated 2026-11-05 and moved to opt-in with its evidence recorded. Without this assertion the registry's primary value proposition — preventing the Lever-8 leak pattern of advertised-but-unverified defaults — silently rots. This scenario does NOT require agent.run(); it asserts structural invariants on the production bootstrap const array.",
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
        e.defaultOn &&
        e.liftEvidence !== null &&
        e.liftEvidence.measuredOn.length < REQUIRED_MEASURED_ON_TIERS,
    );
    const switching = bootstrapEntries.find((e) => e.name === "strategy-switching");

    return {
      // Bootstrap shape stability — must be 4 entries today; growing the
      // registry is fine but the count surfaces here so any addition is
      // an explicit gate update.
      "registry.bootstrap.entry_count": bootstrapEntries.length,
      "registry.bootstrap.entry_count_is_4": bootstrapEntries.length === 4,

      // No default-on entry without lift evidence.
      "registry.violations.count_is_zero": violations.length === 0,

      // Cross-tier coverage on every default-on claim.
      "registry.lift_evidence.no_single_tier_default_on_entries":
        tierGapEntries.length === 0,

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
      "registry.entry.strategy_switching.is_opt_in_with_evidence":
        switching !== undefined && !switching.defaultOn && switching.liftEvidence !== null,
    };
  },
};
