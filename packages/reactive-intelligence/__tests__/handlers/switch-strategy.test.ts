import { test, expect } from "bun:test"
import { Effect } from "effect"
import { switchStrategyHandler } from "../../src/controller/handlers/switch-strategy"

test("requests strategy switch to named target", async () => {
  const outcome = await Effect.runPromise(
    switchStrategyHandler.execute(
      { decision: "switch-strategy", to: "plan-execute-reflect", reason: "loop", confidence: 0.8 } as any,
      { currentStrategy: "reactive" } as any,
      { iteration: 4 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toMatchObject({ kind: "request-strategy-switch", to: "plan-execute-reflect" })
})

test("skips when target matches current strategy", async () => {
  const outcome = await Effect.runPromise(
    switchStrategyHandler.execute(
      { decision: "switch-strategy", to: "reactive", reason: "x", confidence: 0.8 } as any,
      { currentStrategy: "reactive" } as any,
      { iteration: 4 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("same-strategy")
})
