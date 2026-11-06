import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type StreamEvent, type LLMErrors } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { countUnresolvedSinceSuccess } from "../../src/kernel/capabilities/reflect/unresolved-steps.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js"
import { makeKernelRunOptions } from "../../src/testing/kernel-fixtures.js"
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js"
import {
  countConsecutiveUnresolved,
  guardUnresolvedToolCall,
  shouldWithholdTools,
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
  return mockToolServiceLayer({
    execute: () =>
      Effect.succeed({ success: true, result: { results: [{ title: "hit", content: "data" }] } }),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
  })
}

function run(scenario: Parameters<typeof TestLLMService>[0], requiredTools: string[] = ["web-search"]) {
  const inner = TestLLMService(scenario)
  const toolCounts: number[] = []
  /** Per think call: the full wire text (system prompt + every message). */
  const wireTexts: string[] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        toolCounts.push(request.tools?.length ?? 0)
        wireTexts.push(JSON.stringify({ system: request.systemPrompt, messages: request.messages }))
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
        requiredTools,
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    ),
  )
  return { toolCounts, wireTexts, result }
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

describe("countUnresolvedSinceSuccess (seam)", () => {
  const shaped = () => makeStep("thought", "x", UNRESOLVED_STEP_META)
  const obs = (success: boolean) =>
    makeStep("observation", "o", {
      observationResult: { success, toolName: "t", displayText: "o", category: "web-search", resultKind: "data", preserveOnCompaction: false, trustLevel: "trusted" },
    } as never)
  test("failed native call between shaped replies does not reset the total", () => {
    expect(countUnresolvedSinceSuccess([shaped(), makeStep("action", "a"), obs(false), shaped()])).toBe(2)
  })
  test("successful tool observation resets", () => {
    expect(countUnresolvedSinceSuccess([shaped(), makeStep("action", "a"), obs(true), shaped()])).toBe(1)
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

  test("(a2) the withheld call's projected turn states the outstanding requirement as a fact, never a call directive", async () => {
    const { toolCounts, wireTexts, result } = run([
      { text: SHAPED },
      { text: SHAPED },
      { text: "FINAL ANSWER: the answer is 42." },
    ])
    await result
    expect(toolCounts[2]).toBe(0)
    const directive = "call the `web-search` tool"
    // Sanity: with tools offered, the outstanding frame renders the directive.
    expect(wireTexts[0]).toContain(directive)
    // Withheld turn: zero schemas, so no "call X" text anywhere on the wire...
    expect(wireTexts[2]).not.toContain(directive)
    // ...but the requirement is still stated as not yet satisfied.
    expect(wireTexts[2]).toContain("not yet satisfied")
    expect(wireTexts[2]).toContain("tool:web-search")
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

describe("Fix 2: strike accounting does not need strict consecutiveness (guard)", () => {
  const failedObs = () =>
    makeStep("observation", "failed", {
      observationResult: { success: false, toolName: "web-search", displayText: "x", category: "web-search", resultKind: "data", preserveOnCompaction: false, trustLevel: "trusted" },
    } as never)
  // shaped, native call that FAILED, shaped: consecutive count is 1, total is 2.
  const altSteps = () => [
    makeStep("thought", SHAPED, UNRESOLVED_STEP_META),
    makeStep("action", "web-search({})"),
    failedObs(),
    makeStep("thought", SHAPED, UNRESOLVED_STEP_META),
  ]
  const stateWith = (steps: ReturnType<typeof altSteps>) =>
    transitionState(initialKernelState(makeKernelRunOptions({ strategy: "react" })), { steps })
  const turn = { newSteps: [], newTokens: 0, newInputTokens: 0, newOutputTokens: 0, newCost: 0 }

  test("failed native call between shaped replies still withholds tools", () => {
    expect(shouldWithholdTools(stateWith(altSteps()))).toBe(true)
  })
  test("third shaped reply terminates honestly even with a failed call between", async () => {
    const out = await Effect.runPromise(guardUnresolvedToolCall(stateWith(altSteps()), turn, SHAPED))
    expect(out?.meta.terminatedBy).toBe("tool_call_unresolved")
  })
  test("a SUCCESSFUL call between shaped replies still resets", () => {
    const steps = altSteps()
    steps[2] = makeStep("observation", "ok", {
      observationResult: { success: true, toolName: "web-search", displayText: "x", category: "web-search", resultKind: "data", preserveOnCompaction: false, trustLevel: "trusted" },
    } as never)
    expect(shouldWithholdTools(stateWith(steps))).toBe(false)
  })
})

describe("gap 1: shaped first reply never takes the trivial-exit fast path", () => {
  test("no required tools: hallucinated call as FIRST reply is not delivered end_turn", async () => {
    const { toolCounts, result } = run([{ text: SHAPED }, { text: "FINAL ANSWER: the answer is 42." }], [])
    const r = await result
    // Fast path would end after ONE llm call with the JSON as output.
    expect(toolCounts.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(r.output)).not.toContain("not_a_real_tool")
    expect((r.metadata as Record<string, unknown>).rawTerminatedBy).not.toBe("end_turn")
  })
})

describe("gap 2: loop detector / loop-resolution do not preempt the strike guard", () => {
  test("no required tools: persistent shape terminates tool_call_unresolved, no JSON or hint leak", async () => {
    const { toolCounts, result } = run([{ text: SHAPED }], [])
    const r = await result
    const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
    expect(toolCounts[2]).toBe(0) // tools withheld before honest termination
    expect(out).not.toContain("not_a_real_tool")
    expect(out).not.toContain("unavailable name")
    // Without required tools the sentinel terminal is re-labelled "abstained" at finalize (honest either way).
    expect(["tool_call_unresolved", "abstained"]).toContain((r.metadata as Record<string, unknown>).rawTerminatedBy)
    expect(out).toContain("could not produce a valid tool call")
  })
})
