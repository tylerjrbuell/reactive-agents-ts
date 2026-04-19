import { test, expect } from "bun:test"
import { Effect } from "effect"
import { tempAdjustHandler } from "../../src/controller/handlers/temp-adjust"

test("lowers temperature when delta is negative", async () => {
  const outcome = await Effect.runPromise(
    tempAdjustHandler.execute(
      { decision: "temp-adjust", delta: -0.3, reason: "repetition" },
      { currentOptions: { temperature: 0.9 } } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toEqual({ kind: "set-temperature", temperature: 0.6 })
})

test("raises temperature when delta is positive", async () => {
  const outcome = await Effect.runPromise(
    tempAdjustHandler.execute(
      { decision: "temp-adjust", delta: 0.2, reason: "overconfidence" },
      { currentOptions: { temperature: 0.5 } } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toEqual({ kind: "set-temperature", temperature: 0.7 })
})

test("skips when delta is too small (< 0.05)", async () => {
  const outcome = await Effect.runPromise(
    tempAdjustHandler.execute(
      { decision: "temp-adjust", delta: 0.02, reason: "x" },
      { currentOptions: { temperature: 0.7 } } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("delta-too-small")
})

test("clamps result to [0, 1]", async () => {
  const outcome = await Effect.runPromise(
    tempAdjustHandler.execute(
      { decision: "temp-adjust", delta: -0.9, reason: "extreme" },
      { currentOptions: { temperature: 0.2 } } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect((outcome.patches[0] as any).temperature).toBe(0)
})
