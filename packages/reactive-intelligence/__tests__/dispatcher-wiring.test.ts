import { test, expect } from "bun:test"
import { Effect } from "effect"
import { makeDispatcher, registerHandler } from "../src/controller/dispatcher.js"
import { earlyStopHandler } from "../src/controller/handlers/early-stop.js"
import { defaultInterventionConfig } from "../src/controller/intervention.js"

const highEntropyScore = {
  composite: 0.8,
  token: 0.5,
  structural: 0.3,
  semantic: 0.6,
  behavioral: 0.4,
  contextPressure: 0.1,
}

test("dispatcher wiring: early-stop fires when entropy is high and iteration >= 2", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, earlyStopHandler)

  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "loop-detected", iterationsSaved: 2, confidence: 0.95 }],
      { messages: [], currentOptions: {} } as unknown as Readonly<Record<string, unknown>>,
      {
        iteration: 3,
        entropyScore: highEntropyScore,
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      },
    ),
  )

  expect(result.appliedPatches).toHaveLength(1)
  expect(result.appliedPatches[0]!.patch.kind).toBe("early-stop")
  expect(result.skipped).toHaveLength(0)
})

test("dispatcher wiring: early-stop is EXEMPT from entropy floor and fires at low composite", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, earlyStopHandler)

  // early-stop fires at convergence (composite ≤ 0.4), so the 0.55 floor must not block it.
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "loop-detected", iterationsSaved: 1, confidence: 0.6 }],
      { messages: [], currentOptions: {} } as unknown as Readonly<Record<string, unknown>>,
      {
        iteration: 3,
        entropyScore: { ...highEntropyScore, composite: 0.3 }, // below 0.55 — should NOT suppress early-stop
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      },
    ),
  )

  expect(result.appliedPatches).toHaveLength(1)
  expect(result.appliedPatches[0]!.patch.kind).toBe("early-stop")
  expect(result.skipped).toHaveLength(0)
})

test("dispatcher wiring: early-stop is suppressed when iteration is below threshold", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, earlyStopHandler)

  // defaultInterventionConfig.suppression.minIteration = 2
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "early-stop", reason: "loop-detected", iterationsSaved: 1, confidence: 0.8 }],
      { messages: [], currentOptions: {} } as unknown as Readonly<Record<string, unknown>>,
      {
        iteration: 1, // below minIteration=2
        entropyScore: highEntropyScore,
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      },
    ),
  )

  expect(result.appliedPatches).toHaveLength(0)
  expect(result.skipped).toHaveLength(1)
  expect(result.skipped[0]!.reason).toBe("below-iteration-threshold")
})

test("dispatcher wiring: advisory-mode decision is skipped without firing", async () => {
  // WS-4 Phase 2 (2026-05-28) — `human-escalate` removed from the union.
  // Drive the mode-advisory fallback path by overriding a valid decision
  // ("temp-adjust") to "advisory" in modes; no handler registered, so the
  // dispatcher must short-circuit with reason "mode-advisory".
  const advisoryConfig = {
    ...defaultInterventionConfig,
    modes: { ...defaultInterventionConfig.modes, "temp-adjust": "advisory" as const },
  }
  const dispatcher = makeDispatcher(advisoryConfig)
  registerHandler(dispatcher, earlyStopHandler)

  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ decision: "temp-adjust", delta: -0.1, reason: "advisory-test" }],
      { messages: [], currentOptions: {} } as unknown as Readonly<Record<string, unknown>>,
      {
        iteration: 5,
        entropyScore: highEntropyScore,
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      },
    ),
  )

  expect(result.appliedPatches).toHaveLength(0)
  expect(result.skipped).toHaveLength(1)
  expect(result.skipped[0]!.reason).toBe("mode-advisory")
})

test("InterventionDispatcherServiceLive: Layer provides a working dispatcher", async () => {
  const { InterventionDispatcherService, InterventionDispatcherServiceLive } =
    await import("../src/controller/dispatcher-service.js")
  const { Effect: Eff, Layer } = await import("effect")

  const program = Eff.gen(function* () {
    const svc = yield* InterventionDispatcherService
    return yield* svc.dispatch(
      [{ decision: "early-stop", reason: "test", iterationsSaved: 1, confidence: 0.9 }],
      {} as unknown as Readonly<Record<string, unknown>>,
      {
        iteration: 3,
        entropyScore: highEntropyScore,
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      },
    )
  })

  const result = await Eff.runPromise(
    program.pipe(Eff.provide(InterventionDispatcherServiceLive())),
  )

  expect(result.appliedPatches).toHaveLength(1)
  expect(result.appliedPatches[0]!.patch.kind).toBe("early-stop")
})
