import { test, expect } from "bun:test"
import { Effect } from "effect"
import {
  makeDispatcher, registerHandler,
} from "../src/controller/dispatcher"
import { defaultInterventionConfig } from "../src/controller/intervention"

const fakeHandler = {
  type: "early-stop" as const,
  description: "stops",
  defaultMode: "dispatch" as const,
  execute: () => Effect.succeed({
    applied: true,
    patches: [{ kind: "early-stop" as const, reason: "test" }],
    cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
    reason: "fired",
    telemetry: {},
  }),
}

test("dispatches a decision to its handler when mode is 'dispatch'", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "loop", iterationsSaved: 1 }],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.8, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.appliedPatches).toHaveLength(1)
  expect(result.skipped).toHaveLength(0)
})

test("suppresses non-early-stop decisions when composite entropy below threshold", async () => {
  // early-stop is exempt from the entropy floor (fires at LOW entropy for convergence).
  // Use a handler that is NOT early-stop to test the suppression gate.
  const compressHandler = {
    type: "compress" as const,
    description: "compress",
    defaultMode: "dispatch" as const,
    execute: () => Effect.succeed({
      applied: true,
      patches: [],
      cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
      reason: "fired",
      telemetry: {},
    }),
  }
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, compressHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "compress", sections: [], estimatedSavings: 0 }],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.1, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.skipped[0].reason).toBe("below-entropy-threshold")
})

test("early-stop is exempt from entropy floor and fires at low composite", async () => {
  // early-stop fires at convergence (composite ≤ 0.4), so the 0.55 floor must not block it.
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "converged", iterationsSaved: 3 }],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.1, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.appliedPatches).toHaveLength(1)
  expect(result.skipped).toHaveLength(0)
})

test("advisory mode does not apply patches", async () => {
  const dispatcher = makeDispatcher({
    ...defaultInterventionConfig,
    modes: { "early-stop": "advisory" },
  })
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "x", iterationsSaved: 1 }],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.9, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.appliedPatches).toHaveLength(0)
  expect(result.skipped[0].reason).toBe("mode-advisory")
})
