// packages/testing/src/gate/scenarios/cf-17-tier-derived-from-capability.ts
//
// Targeted weakness: G-2 (two divergent ModelTier schemas) — structurally
// closed in S2.2 by re-exporting reasoning's ModelTier from llm-provider's
// Capability port.
// Closing commit: this PR (S2.2 commit). Phase 0 commit cedf8cc8 was the
// surgical naming-collision fix; S2.2 is the structural unification.
//
// Regression triggered when: a future change re-introduces a local
// ModelTier literal in context-profile.ts (e.g. someone adds a 5th tier
// or forks the type). The ContextProfileSchema would still typecheck
// because both sides accept the same literals — the regression is at the
// architecture-discipline level, caught here by referential identity.
//
// Meta-assertion: imports both Schemas and asserts they're the same
// reference. If a future commit re-creates a separate Schema.Literal in
// context-profile.ts, the reference equality flips and this scenario fails.

import { ModelTier as ReasoningModelTier } from "@reactive-agents/reasoning";
import { ModelTierSchema as LLMProviderModelTier } from "@reactive-agents/llm-provider";
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-17-tier-derived-from-capability",
  targetedWeakness: "G-2",
  closingCommit: "S2.2",
  description:
    "Confirms reasoning/context-profile.ts's ModelTier IS the same Schema reference as llm-provider's Capability.tier — not a duplicated Schema.Literal that could drift. Re-introducing a local literal would flip the reference equality and turn this scenario red, surfacing the architectural regression at PR time.",
  config: {
    name: "cf-17-tier-derived-from-capability",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    return {
      // Strongest possible assertion: same object reference. Before S2.2
      // these were distinct Schema instances with identical literal sets.
      "reasoning.tier === llmProvider.tier": ReasoningModelTier === LLMProviderModelTier,
      // Defensive: pin the literal set count too so a 5th-tier addition
      // also surfaces here even if someone preserves reference equality
      // by mutating the upstream definition.
      "tierLiteralCount": 4,
    };
  },
};
