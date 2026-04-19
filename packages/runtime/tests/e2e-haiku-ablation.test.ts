// packages/runtime/tests/e2e-haiku-ablation.test.ts
//
// OLLAMA_E2E-gated ablation: verifies that reactive-intelligence interventions
// are dispatched on the loop-prone haiku task with RI enabled, and are absent
// in the counterfactual run where RI is disabled.
//
// Run with:  OLLAMA_E2E=1 bun test tests/e2e-haiku-ablation.test.ts

import { test, expect } from "bun:test"
import { runCounterfactual } from "@reactive-agents/testing"
import { loopProneHaiku } from "@reactive-agents/scenarios"
import { expectTrace } from "@reactive-agents/testing"
import { traceStats } from "@reactive-agents/trace"

test.skipIf(!process.env.OLLAMA_E2E)(
  "RI dispatches interventions on loop-prone haiku; counterfactual (no RI) dispatches none",
  async () => {
    const r = await runCounterfactual(
      // baseline: RI enabled
      {
        name: `${loopProneHaiku.id}-baseline`,
        task: loopProneHaiku.task,
        provider: "ollama",
        model: "qwen3:latest",
        withReactiveIntelligence: true,
      },
      // variant: RI disabled (ablation)
      {
        name: `${loopProneHaiku.id}-ablation`,
        task: loopProneHaiku.task,
        provider: "ollama",
        model: "qwen3:latest",
        withReactiveIntelligence: false,
      },
    )

    const s1 = traceStats(r.baseline.trace)
    const s2 = traceStats(r.variant.trace)
    console.log("Baseline (RI on):", s1)
    console.log("Variant (RI off / ablation):", s2)

    // Baseline must have at least one intervention dispatched
    expect(s1.interventionsDispatched).toBeGreaterThan(0)

    // Ablation variant must have no interventions (RI is off)
    expect(s2.interventionsDispatched).toBe(0)

    // Baseline trace must show a completed run
    expectTrace(r.baseline.trace).toHaveCompleted("success")
  },
  300_000,
)
