// packages/testing/src/gate/scenarios/cf-15-num-ctx-from-capability.ts
//
// Targeted weakness: G-1 (silent num_ctx truncation on Ollama).
// Closing commits: 838fb721 (Phase 0 surgical fix) → 0601ba8c (Phase 1
// S1.3 capability-driven resolution superseding the surgical fix).
//
// Regression triggered when: resolveCapability stops returning the static
// table's recommendedNumCtx for a known model, OR when a future change
// re-introduces the silent 2048 default for unknown models without going
// through the fallback-with-source-tag path.
//
// Meta-assertion: exercises the resolver directly rather than booting an
// Ollama agent (no real LLM needed, deterministic, fast). Pins the
// capability values for cogito:14b + qwen3:14b and verifies the fallback
// shape for an unknown model.

import { resolveCapability, STATIC_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-15-num-ctx-from-capability",
  targetedWeakness: "G-1",
  closingCommit: "0601ba8c",
  description:
    "Confirms Capability resolution drives Ollama options.num_ctx: cogito:14b → 8192 from static table; unknown models → 2048 fallback with source: 'fallback'. G-1 (silent 2048 truncation) was first patched surgically in 838fb721, then structurally closed in S1.3 (0601ba8c) with capability-driven resolution. This scenario pins both behaviors.",
  config: {
    name: "cf-15-num-ctx-from-capability",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // Static table hit — the value the Ollama provider will use.
    const cogito = resolveCapability("ollama", "cogito:14b");
    const qwen3 = resolveCapability("ollama", "qwen3:14b");
    // Fallback path — confirms the conservative-default chain still works.
    const unknown = resolveCapability("ollama", "private-model:never-shipped");
    // Static table integrity check — drift here means STATIC_CAPABILITIES
    // got mutated unexpectedly.
    const staticCogito = STATIC_CAPABILITIES["ollama/cogito:14b"];

    return {
      "cogito.recommendedNumCtx": cogito.recommendedNumCtx,
      "cogito.source": cogito.source,
      "qwen3.recommendedNumCtx": qwen3.recommendedNumCtx,
      "qwen3.source": qwen3.source,
      "unknown.recommendedNumCtx": unknown.recommendedNumCtx,
      "unknown.source": unknown.source,
      "staticTable.cogito.recommendedNumCtx": staticCogito?.recommendedNumCtx ?? -1,
      "staticTable.cogito.tier": staticCogito?.tier ?? "missing",
    };
  },
};
