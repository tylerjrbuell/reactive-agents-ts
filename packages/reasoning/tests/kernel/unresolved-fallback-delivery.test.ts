import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ToolService } from "@reactive-agents/tools"
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import {
  chooseFallbackThought,
  UNRESOLVED_STEP_META,
} from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"
import { resolvePassOutput } from "../../src/kernel/loop/run-pass.js"
import type { KernelState } from "../../src/kernel/state/kernel-state.js"

// Fix 1 (2026-10-29): last-thought fallbacks must never deliver a shaped-reply
// (tagged) thought or the resolver hint. Iteration cap hits before strike 3.

const TOOL_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
}
const SHAPED = '{"name":"not_a_real_tool","parameters":{"q":"x"}}'

const toolLayer = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: () => Effect.succeed({ success: true, result: {} }),
    getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
)

describe("chooseFallbackThought (seam)", () => {
  const shaped = (c: string) => makeStep("thought", c, UNRESOLVED_STEP_META)
  test("only shaped artifacts -> unresolved", () => {
    expect(chooseFallbackThought([makeStep("thought", SHAPED), shaped(`${SHAPED} hint`)])).toEqual({ kind: "unresolved" })
  })
  test("prose before shaped tail -> prose, never the shaped one", () => {
    const r = chooseFallbackThought([makeStep("thought", "real prose"), makeStep("thought", SHAPED), shaped(`${SHAPED} hint`)])
    expect(r).toEqual({ kind: "prose", content: "real prose" })
  })
  test("no thoughts -> undefined", () => {
    expect(chooseFallbackThought([makeStep("observation", "o")])).toBeUndefined()
  })
  test("resolvePassOutput never resurrects a shaped thought", () => {
    const state = {
      output: null,
      meta: {},
      steps: [makeStep("thought", SHAPED), shaped(`${SHAPED} Tool call used unavailable tool`)],
    } as unknown as KernelState
    const out = resolvePassOutput(state) ?? ""
    expect(out).not.toContain("not_a_real_tool")
    expect(out).toContain("could not produce a valid tool call")
  })
})

describe("iteration cap before strike 3 (runner)", () => {
  test("two shaped replies then cap -> honest sentinel, no hint/JSON leak", async () => {
    const inner = TestLLMService([{ text: SHAPED }])
    const r = await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: "find the answer",
          taskType: "simple",
          memoryContext: "",
          availableTools: ["web-search"],
          requiredTools: ["web-search"],
          availableToolSchemas: [TOOL_SCHEMA],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 2 },
            },
          },
        }).pipe(Effect.provide(Layer.merge(Layer.succeed(LLMService, LLMService.of({ ...inner })), toolLayer))),
      ),
    )
    const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
    expect(out).not.toContain("not_a_real_tool")
    expect(out).not.toContain("Tool call used unavailable")
    expect(out).toContain("could not produce a valid tool call")
  })
})
