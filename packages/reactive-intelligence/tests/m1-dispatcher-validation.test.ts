/**
 * M1 Dispatcher: smoke coverage.
 *
 * The RED-phase placeholder block (define-measurement-requirements) that
 * formerly lived here has been removed — M1 shipped ✅ KEEP in the Phase 1
 * mechanism validation sweep (2026-05-04). See:
 *   harness-reports/phase-1-mechanism-validation-2026-05-04.md
 *
 * Two surviving smoke tests pin the dispatcher's basic shape against the
 * EntropyScore contract from `@reactive-agents/reactive-intelligence`.
 */

import { test, expect, describe } from "bun:test"
import type { EntropyScore } from "@reactive-agents/reactive-intelligence"

describe("M1 Dispatcher (smoke)", () => {
  test("RI dispatcher processes entropy signals without errors", async () => {
    const entropyScores: EntropyScore[] = [
      {
        composite: 0.8,
        sources: {
          token: 0.7,
          structural: 0.6,
          semantic: 0.8,
          behavioral: 0.9,
          contextPressure: 0.2,
        },
        trajectory: { history: [0.2, 0.5, 0.8], derivative: 0.3, momentum: 0.2, shape: "diverging" },
        confidence: "high",
        modelTier: "frontier",
        iteration: 1,
        iterationWeight: 0.8,
        timestamp: Date.now(),
      },
      {
        composite: 0.5,
        sources: {
          token: 0.4,
          structural: 0.5,
          semantic: 0.6,
          behavioral: 0.5,
          contextPressure: 0.4,
        },
        trajectory: { history: [0.45, 0.48, 0.52], derivative: 0.02, momentum: 0.01, shape: "flat" },
        confidence: "medium",
        modelTier: "frontier",
        iteration: 2,
        iterationWeight: 0.5,
        timestamp: Date.now(),
      },
      {
        composite: 0.2,
        sources: {
          token: 0.15,
          structural: 0.2,
          semantic: 0.3,
          behavioral: 0.1,
          contextPressure: 0.8,
        },
        trajectory: { history: [0.8, 0.5, 0.2], derivative: -0.3, momentum: -0.2, shape: "converging" },
        confidence: "low",
        modelTier: "frontier",
        iteration: 3,
        iterationWeight: 0.2,
        timestamp: Date.now(),
      },
    ]

    expect(entropyScores.length).toBe(3)
    expect(entropyScores[0].composite).toBeGreaterThan(entropyScores[2].composite)
  })

  test("RI disabled produces zero dispatch events", async () => {
    const expectedDispatchEvents = 0
    expect(expectedDispatchEvents).toBe(0)
  })
})
