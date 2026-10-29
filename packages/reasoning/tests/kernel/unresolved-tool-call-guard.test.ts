import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { ToolService } from "@reactive-agents/tools"
import { LLMService, TestLLMService, type StreamEvent, type LLMErrors } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import {
  countConsecutiveUnresolved,
  UNRESOLVED_STEP_META,
} from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"

// F2 (2026-10-29-text-tool-call-root-cause.md): two consecutive tool-call-shaped
// unresolved replies => the NEXT think call ships with NO tools; a third shaped
// reply terminates honestly (terminatedBy "tool_call_unresolved"), never the JSON.

const TOOL_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
}
const SHAPED = '{"name":"not_a_real_tool","parameters":{"q":"x"}}'

function toolLayer() {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      execute: () => Effect.succeed({ success: true, result: { results: [{ title: "hit", content: "data" }] } }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  )
}

function run(scenario: Parameters<typeof TestLLMService>[0]) {
  const inner = TestLLMService(scenario)
  const toolCounts: number[] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        toolCounts.push(request.tools?.length ?? 0)
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
      },
    }),
  )
  const result = Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "find the answer",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        requiredTools: ["web-search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    ),
  )
  return { toolCounts, result }
}

describe("countConsecutiveUnresolved (seam)", () => {
  const shaped = () => makeStep("thought", "x", UNRESOLVED_STEP_META)
  test("counts tail run, skips observations", () => {
    expect(countConsecutiveUnresolved([shaped(), makeStep("observation", "o"), shaped()])).toBe(2)
  })
  test("action step resets", () => {
    expect(countConsecutiveUnresolved([shaped(), shaped(), makeStep("action", "a")])).toBe(0)
  })
  test("untagged thought resets", () => {
    expect(countConsecutiveUnresolved([shaped(), makeStep("thought", "plain"), shaped()])).toBe(1)
  })
})

describe("unresolved-tool-call strike guard (runner)", () => {
  test("(a) request after two shaped replies has no tools; plain prose then answers", async () => {
    const { toolCounts, result } = run([
      { text: SHAPED },
      { text: SHAPED },
      { text: "FINAL ANSWER: the answer is 42." },
    ])
    const r = await result
    expect(toolCounts.length).toBeGreaterThanOrEqual(3)
    expect(toolCounts[0]).toBeGreaterThan(0)
    expect(toolCounts[1]).toBeGreaterThan(0)
    expect(toolCounts[2]).toBe(0)
    expect(JSON.stringify(r.output)).not.toContain("not_a_real_tool")
  })

  test("(b) a real tool call resets the strike counter", async () => {
    // shaped, real call, shaped, answer: never two CONSECUTIVE strikes, so tools always offered.
    const { toolCounts, result } = run([
      { text: SHAPED },
      { toolCall: { name: "web-search", args: { query: "x" } } },
      { text: SHAPED },
      { text: "FINAL ANSWER: done" },
    ])
    await result
    expect(toolCounts.length).toBeGreaterThanOrEqual(2)
    expect(toolCounts.every((n) => n > 0)).toBe(true)
  })

  test("(c) persistent shape terminates honestly with the marker", async () => {
    const { toolCounts, result } = run([{ text: SHAPED }])
    const r = await result
    expect(toolCounts[2]).toBe(0)
    const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
    expect(out).not.toContain("not_a_real_tool")
    expect(out).toContain("could not produce a valid tool call")
    expect((r.metadata as Record<string, unknown>).rawTerminatedBy).toBe("tool_call_unresolved")
  })

  test("(d) a single shaped reply then a valid call keeps tools offered", async () => {
    const { toolCounts, result } = run([
      { text: SHAPED },
      { toolCall: { name: "web-search", args: { query: "x" } } },
      { text: "FINAL ANSWER: done" },
    ])
    await result
    expect(toolCounts.every((n) => n > 0)).toBe(true)
  })
})
