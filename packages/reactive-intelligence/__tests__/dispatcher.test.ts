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
      [{ type: "early-stop", reason: "loop", confidence: 0.9 } as any],
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

test("suppresses when composite entropy below threshold", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ type: "early-stop", reason: "x", confidence: 0.9 } as any],
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

test("advisory mode does not apply patches", async () => {
  const dispatcher = makeDispatcher({
    ...defaultInterventionConfig,
    modes: { "early-stop": "advisory" },
  })
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ type: "early-stop", reason: "x", confidence: 0.9 } as any],
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
