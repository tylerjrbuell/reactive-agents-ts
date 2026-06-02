// packages/testing/src/gate/scenarios/cf-22-kernel-internal-structure.ts
//
// Targeted weakness: kernel internals previously sprawled across
// src/strategies/kernel/{phases,utils}/ with mixed concerns. Phase 2
// Sprint 3.1 reorganized the kernel into capability folders per North
// Star v3.0 §5.2.
// Closing commit: Sprint 3.1 batch 4 — kernel reorganization complete.
//
// Regression triggered when:
//   1. A capability folder is removed (e.g. someone deletes verify/ before
//      Verifier promotion in Sprint 3.2 lands)
//   2. Files leak back into the old src/strategies/kernel/ tree
//   3. The state/, loop/, capabilities/, utils/ top-level structure is
//      reorganized without updating this scenario
//
// Meta-assertion: imports public symbols from each capability folder via
// the package barrel. If a capability's public surface vanishes, the
// import resolution fails — caught at typecheck-time before this scenario
// even runs. The customAssertions then verify the symbols are real.
//
// Sprint 3.1 deliberately does NOT pin folder-level structure via
// filesystem reads (that would be brittle and platform-dependent).
// Instead it pins that key public symbols continue to be reachable
// through the public API after the reorganization.

import {
  // From src/kernel/state/ via the package barrel
  META_TOOLS,
  INTROSPECTION_META_TOOLS,
  // From src/kernel/capabilities/decide/ (was utils/termination-oracle)
  evaluateTermination,
  defaultEvaluators,
  controllerSignalVetoEvaluator,
  // From src/kernel/capabilities/attend/ (was utils/tool-formatting)
  filterToolsByRelevance,
  // From src/kernel/capabilities/act/ (was utils/tool-gating)
  planNextMoveBatches,
} from "@reactive-agents/reasoning";
// Sprint-1 A3 (2026-06-02): defaultContextCurator + RECENT_OBSERVATIONS_HEADER
// deleted with the curator module. Canonical project() is the sole assembler
// (see packages/reasoning/src/assembly/project.ts). The two curator assertions
// below were removed; the structural pins on state/decide/attend/act survive.
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-22-kernel-internal-structure",
  targetedWeakness: "G-5/Sprint-3.1",
  closingCommit: "Sprint-3.1",
  description:
    "Pins the post-Sprint-3.1 kernel internal structure: state/, loop/, capabilities/{sense,attend,comprehend,reason,decide,act,verify,reflect,learn}/, utils/. Asserts that key public symbols from each capability area continue to be reachable via the package's public API. The reorganization moved ~30 files into capability folders without behavior change; this scenario ensures the move is durable — a future regression that re-scatters concerns would either fail to compile or fail this scenario's symbol-presence checks.",
  config: {
    name: "cf-22-kernel-internal-structure",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    return {
      // State concern
      "state.META_TOOLS_is_set": META_TOOLS instanceof Set,
      "state.INTROSPECTION_META_TOOLS_is_set":
        INTROSPECTION_META_TOOLS instanceof Set,
      // Decide capability (the future Arbitrator home)
      "decide.evaluateTermination_is_function":
        typeof evaluateTermination === "function",
      "decide.defaultEvaluators_is_array": Array.isArray(defaultEvaluators),
      "decide.controllerSignalVeto_in_defaults": defaultEvaluators.some(
        (e) => e.name === "ControllerSignalVeto",
      ),
      // Attend capability
      "attend.filterToolsByRelevance_is_function":
        typeof filterToolsByRelevance === "function",
      // Act capability
      "act.planNextMoveBatches_is_function":
        typeof planNextMoveBatches === "function",
      // Curator assertions REMOVED Sprint-1 A3 (2026-06-02): defaultContextCurator
      // + RECENT_OBSERVATIONS_HEADER deleted with the curator module. project()
      // is the sole assembler now.
    };
  },
};
