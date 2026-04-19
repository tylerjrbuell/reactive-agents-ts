import { test, expect } from "bun:test"
import { Effect } from "effect"
import { contextCompressHandler } from "../../src/controller/handlers/context-compress"

test("compresses when savings exceed cost threshold", async () => {
  const outcome = await Effect.runPromise(
    contextCompressHandler.execute(
      { decision: "compress", sections: ["tool-results", "history"], estimatedSavings: 2000 },
      {
        messages: Array.from({ length: 30 }, () => ({ role: "tool", content: "x", tokens: 500 })),
        currentOptions: {},
        tokens: 15000,
      } as any,
      { iteration: 8 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0].kind).toBe("compress-messages")
})

test("skips when savings would be minimal", async () => {
  const outcome = await Effect.runPromise(
    contextCompressHandler.execute(
      { decision: "compress", sections: ["tool-results"], estimatedSavings: 100 },
      { messages: [{ role: "user", content: "x", tokens: 100 }], currentOptions: {}, tokens: 500 } as any,
      { iteration: 2 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("savings-below-cost")
})
