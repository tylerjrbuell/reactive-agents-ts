import { test, expect } from "bun:test"
import { Effect } from "effect"
import { toolInjectHandler } from "../../src/controller/handlers/tool-inject"

test("injects tool guidance text from decision", async () => {
  const outcome = await Effect.runPromise(
    toolInjectHandler.execute(
      { decision: "tool-inject", toolName: "web-search", reason: "model skipping tools" },
      { currentOptions: {}, messages: [] } as any,
      { iteration: 2 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toMatchObject({ kind: "inject-tool-guidance" })
  expect((outcome.patches[0] as any).text).toContain("web-search")
})

test("skips when toolName is empty string", async () => {
  const outcome = await Effect.runPromise(
    toolInjectHandler.execute(
      { decision: "tool-inject", toolName: "", reason: "skipping" },
      { currentOptions: {}, messages: [] } as any,
      { iteration: 2 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("no-tool-name")
})
