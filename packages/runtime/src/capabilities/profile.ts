/**
 * HarnessProfile — composition presets for default-on capability sets
 * (MOVE-6 per master plan §0 / vision pillar 1 "control over magic").
 *
 * Replaces the leaky `.withLeanHarness()` (which historically disabled
 * verifier + strategy-switching + memory but NOT reactive-intelligence —
 * the gap surfaced by Lever 8's regression) with three named factories:
 *
 *   • `HarnessProfile.lean()` — true zero-default-capability mode.
 *     Disables ALL 4 bootstrap-default-on entries in the
 *     CapabilityRegistry (memory, reactive-intelligence, verifier,
 *     strategy-switching). For latency / cost-sensitive workloads where
 *     the model is the entire harness.
 *
 *   • `HarnessProfile.balanced()` — today's production defaults.
 *     No-op patch; default registry entries stay on.
 *
 *   • `HarnessProfile.intelligent()` — balanced + opt-in compounding
 *     intelligence (skill persistence enabled by default; future:
 *     adaptive routing + healing pipeline once registered).
 *
 * Applied via `builder.withProfile(profile)`. Composes with other
 * builder methods — order matters: later calls override earlier patches
 * (e.g., `.withProfile(lean()).withMemory()` re-enables memory).
 *
 * Per master plan §9 Anti-Scaffold: this file ships in the same commit
 * as the builder's `.withProfile()` method (the wired consumer).
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-26-capability-cost-registry.md §1.3
 */

export type HarnessProfileName = "lean" | "balanced" | "intelligent";

/**
 * Structured patch applied by `builder.withProfile()`. Each field is
 * optional — `undefined` means "do not change the current builder
 * setting", `true`/`false` means "explicitly set". Mirrors the registry's
 * default-on entries (4 today; grows as the registry does).
 */
export interface HarnessProfilePatch {
  readonly name: HarnessProfileName;
  readonly enableMemory?: boolean;
  readonly enableReactiveIntelligence?: boolean;
  readonly enableVerifier?: boolean;
  readonly enableStrategySwitching?: boolean;
  readonly enableSkillPersistence?: boolean;
}

export const HarnessProfile = {
  /**
   * Disables every registry-registered default-on capability. Truly lean
   * — the agent runs the model and nothing else. Closes the historical
   * `.withLeanHarness()` leak (which did not disable RI).
   *
   * Use for benchmark ablation cells, latency-critical production paths,
   * and any context where the harness's verified lift cannot earn its
   * token / latency budget.
   *
   * @returns config patch consumed by `builder.withProfile()`
   */
  lean(): HarnessProfilePatch {
    return {
      name: "lean",
      enableMemory: false,
      enableReactiveIntelligence: false,
      enableVerifier: false,
      enableStrategySwitching: false,
      enableSkillPersistence: false,
    };
  },

  /**
   * Today's production defaults — the 4 bootstrap-default-on registry
   * entries (memory + reactive-intelligence + verifier +
   * strategy-switching). Skill persistence stays opt-in.
   *
   * No-op patch — registered entries already start enabled. Provided as
   * the named third member of the {lean, balanced, intelligent} contract
   * so users can be explicit about choosing default behavior.
   *
   * @returns empty patch (no field overrides)
   */
  balanced(): HarnessProfilePatch {
    return {
      name: "balanced",
    };
  },

  /**
   * Balanced + opt-in compounding intelligence. Enables skill persistence
   * so the agent's learned skills carry across sessions. Future additions
   * (adaptive routing, healing pipeline) will register here once their
   * lift evidence is captured in the CapabilityRegistry.
   *
   * @returns patch enabling cross-session learning surfaces
   */
  intelligent(): HarnessProfilePatch {
    return {
      name: "intelligent",
      enableSkillPersistence: true,
    };
  },
} as const;
