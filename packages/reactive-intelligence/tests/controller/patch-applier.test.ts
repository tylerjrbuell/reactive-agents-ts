import { test, expect } from "bun:test"
import { applyPatches } from "../../src/controller/patch-applier"

test("applies set-temperature patch", () => {
  const state = { currentOptions: { temperature: 0.7 }, messages: [], steps: [] } as any
  const out = applyPatches(state, [{ kind: "set-temperature", temperature: 0.3 }])
  expect((out as any).currentOptions.temperature).toBe(0.3)
})

test("applies compress-messages by trimming oldest until target", () => {
  const state = {
    messages: Array.from({ length: 10 }, (_, i) => ({
      role: "user", content: `msg-${i}`, tokens: 100,
    })),
    currentOptions: {}, steps: [],
  } as any
  const out = applyPatches(state, [{ kind: "compress-messages", targetTokens: 300 }])
  expect((out as any).messages.length).toBeLessThanOrEqual(4)
})

test("compress-messages falls back to count-based when messages have no token annotations", () => {
  const state = {
    messages: Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `msg-${i}` })),
    currentOptions: {}, steps: [],
  } as any
  // targetTokens 400 → keepCount = ceil(400/200) = 2 → keeps last 2
  const out = applyPatches(state, [{ kind: "compress-messages", targetTokens: 400 }])
  expect((out as any).messages.length).toBeLessThanOrEqual(3)
  expect((out as any).messages.length).toBeGreaterThanOrEqual(1)
})

test("unknown patch kind throws (exhaustiveness check)", () => {
  const state = { currentOptions: {}, messages: [], steps: [] } as any
  expect(() => applyPatches(state, [{ kind: "unknown-kind" } as any])).toThrow()
})
