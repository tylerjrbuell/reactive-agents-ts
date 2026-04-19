// packages/testing/tests/scenario.test.ts

import { test, expect } from "bun:test"
import { runScenario, runCounterfactual } from "../src/harness/scenario.js"

test("runScenario returns a trace with run-started and run-completed events", async () => {
  const result = await runScenario({
    name: "test-ping",
    task: "ping",
    tracingDir: `/tmp/scenario-test-${Date.now()}`,
    testTurns: [{ text: "pong" }],
  })

  expect(result.runId).toBeTruthy()
  expect(result.output).toBeTruthy()
  expect(result.durationMs).toBeGreaterThan(0)
  expect(result.trace.events.some((e) => e.kind === "run-started")).toBe(true)
  expect(result.trace.events.some((e) => e.kind === "run-completed")).toBe(true)
})

test("runCounterfactual runs both scenarios and computes diff", async () => {
  const base = {
    name: "cf-base",
    task: "what is 1+1?",
    tracingDir: `/tmp/scenario-cf-base-${Date.now()}`,
    testTurns: [{ text: "The answer is 2." }],
  }
  const variant = {
    name: "cf-variant",
    task: "what is 1+1?",
    tracingDir: `/tmp/scenario-cf-variant-${Date.now()}`,
    testTurns: [{ text: "2" }],
  }

  const cf = await runCounterfactual(base, variant)

  expect(cf.baseline.runId).toBeTruthy()
  expect(cf.variant.runId).toBeTruthy()
  // Both runs produce different outputs → outputChanged true
  expect(cf.diff.outputChanged).toBe(true)
  // Neither run has interventions (mock LLM, no entropy)
  expect(cf.diff.interventionsBaselineOnly).toHaveLength(0)
  expect(cf.diff.interventionsVariantOnly).toHaveLength(0)
})
