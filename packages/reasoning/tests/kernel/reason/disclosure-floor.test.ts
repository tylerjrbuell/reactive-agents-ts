// Run: bun test packages/reasoning/tests/kernel/reason/disclosure-floor.test.ts --timeout 15000
//
// Spec 2026-11-06 skills-and-extension-model §12.3 / §12.5 F3: two disclosure
// rules over the PERMITTED set (the run catalog ∪ the offered set, minus the
// contract deny-list), both enforced in tool-surface.ts `resolveToolSurface`.
//   - Never-zero floor: when the pruned surface holds no domain tool but some
//     tool is permitted, the surface gains required/floor tools, tools the task
//     names, and the keyword top-5. Never an unpermitted tool.
//   - Offer gating: `discover-tools` is offered only while permitted − visible
//     is non-empty. With nothing hidden it can only answer "nothing new".
// Two layers: the pure resolver (seam), then the real runner's turn-1 FC wire.

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent } from "@reactive-agents/llm-provider"
import { resolveToolSurface, type ToolSurfaceInputs } from "../../../src/kernel/capabilities/reason/tool-surface.js"
import type { ToolSchema } from "../../../src/kernel/capabilities/attend/tool-formatting.js"
import { resolveHarnessConfig } from "../../../src/harness-config.js"
import { executeReactive } from "../../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../../src/types/config.js"
import { provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js"
import { ToolService, createToolsLayer } from "@reactive-agents/tools"

const schema = (name: string, description = `${name} tool`): ToolSchema => ({ name, description, parameters: [] })
const names = (xs: readonly ToolSchema[]) => xs.map((t) => t.name)

const WEATHER = schema("weather-lookup", "Look up the current weather forecast for a city")
const CALENDAR = schema("calendar-events", "List calendar events")
const DISCOVER = schema("discover-tools", "List callable tools")
const FINAL = schema("final-answer")

const inputs = (over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs => ({
  augmented: [DISCOVER],
  finalAnswerSchema: FINAL,
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [],
  relevantTools: [],
  allowedTools: [],
  toolsUsed: [],
  discovered: [],
  gateBlockedTools: [],
  missingRequiredTools: [],
  pruneMinTools: 15,
  catalog: [WEATHER, CALENDAR],
  taskText: "What is the weather in Paris?",
  harness: resolveHarnessConfig(),
  ...over,
})

describe("never-zero floor (resolver seam)", () => {
  test("a meta-only surface gains the permitted tool the task's keywords match", () => {
    const s = resolveToolSurface(inputs())
    expect(names(s.visible)).toContain("weather-lookup")
    expect(names(s.callable)).toContain("weather-lookup")
    expect(names(s.universe)).toContain("weather-lookup")
    expect(s.reasons.get("weather-lookup")).toContain("never-zero floor")
    // Only the matching tool: the floor is not "show everything".
    expect(names(s.visible)).not.toContain("calendar-events")
  })

  test("required and task-named tools join the floor", () => {
    const s = resolveToolSurface(
      inputs({ requiredTools: ["calendar-events"], taskText: "Use weather-lookup please" }),
    )
    expect(names(s.visible)).toEqual(expect.arrayContaining(["calendar-events", "weather-lookup"]))
  })

  test("the floor never draws an unpermitted (forbidden) tool", () => {
    const s = resolveToolSurface(inputs({ forbiddenTools: ["weather-lookup"] }))
    expect(names(s.visible)).not.toContain("weather-lookup")
  })

  test("no source matches: no floor, and discover-tools stays offered over the non-empty catalog", () => {
    const s = resolveToolSurface(inputs({ taskText: "Summarize our talk" }))
    expect(names(s.visible)).toEqual(["discover-tools"])
  })

  test("the pressure arm's final-answer-only narrowing is not re-widened", () => {
    const s = resolveToolSurface(inputs({ lazyMode: false, pressureCritical: true }))
    expect(names(s.visible)).toEqual(["final-answer"])
  })
})

describe("discover-tools offer gating (resolver seam)", () => {
  test("every permitted tool visible: discover-tools is not offered", () => {
    const s = resolveToolSurface(inputs({ augmented: [WEATHER, DISCOVER], catalog: [WEATHER] }))
    expect(names(s.visible)).toEqual(["weather-lookup"])
    expect(names(s.callable)).not.toContain("discover-tools")
    expect(s.reasons.get("discover-tools")).toContain("nothing to discover")
  })

  test("a permitted tool is still hidden: discover-tools stays offered", () => {
    const s = resolveToolSurface(inputs({ augmented: [WEATHER, DISCOVER], catalog: [WEATHER, CALENDAR] }))
    expect(names(s.visible)).toEqual(expect.arrayContaining(["weather-lookup", "discover-tools"]))
    expect(names(s.visible)).not.toContain("calendar-events")
  })

  test("an empty catalog with no domain tool (tool-less retry pass) does not offer discover-tools", () => {
    const s = resolveToolSurface(inputs({ augmented: [DISCOVER], catalog: [] }))
    expect(names(s.visible)).toEqual([])
  })
})

// 2026-11-06: models called `recall` before any tool had run, when it could
// only answer "not found". The same precondition table that gates
// discover-tools withholds recall until a tool that can store a result ran.
describe("recall offer gating (resolver seam)", () => {
  const RECALL = schema("recall", "Recall a stored tool result")
  const recallInputs = (over: Partial<ToolSurfaceInputs> = {}) =>
    inputs({ augmented: [WEATHER, RECALL], catalog: [WEATHER], ...over })

  test("turn 0, no tool has run: recall is hidden with a reason", () => {
    const s = resolveToolSurface(recallInputs())
    expect(names(s.visible)).not.toContain("recall")
    expect(names(s.callable)).not.toContain("recall")
    expect(s.reasons.get("recall")).toBe("hidden: nothing to recall yet (no tool has run)")
  })

  test("after a domain tool ran: recall is offered", () => {
    const s = resolveToolSurface(recallInputs({ toolsUsed: ["weather-lookup"] }))
    expect(names(s.visible)).toContain("recall")
    expect(names(s.callable)).toContain("recall")
  })

  test("a meta tool whose result can be stored (find) unlocks recall; recall-silent ones do not", () => {
    expect(names(resolveToolSurface(recallInputs({ toolsUsed: ["find"] })).visible)).toContain("recall")
    const silent = resolveToolSurface(recallInputs({ toolsUsed: ["discover-tools", "brief", "pulse", "todo", "recall"] }))
    expect(names(silent.visible)).not.toContain("recall")
  })

  test("a required recall is never hidden", () => {
    const s = resolveToolSurface(recallInputs({ requiredTools: ["recall"] }))
    expect(names(s.visible)).toContain("recall")
  })

  test("a required discover-tools is never hidden, even with nothing to discover", () => {
    const s = resolveToolSurface(
      inputs({ augmented: [WEATHER, DISCOVER], catalog: [WEATHER], requiredTools: ["discover-tools"] }),
    )
    expect(names(s.visible)).toContain("discover-tools")
  })
})

// ─── The real runner: the turn-1 FC wire ─────────────────────────────────────

/** Run one reactive pass; return the FC tool names of the first model request. */
const turnOneWire = async (available: readonly ToolSchema[], catalog: readonly ToolSchema[]): Promise<string[]> => {
  const inner = TestLLMService([{ text: "FINAL ANSWER: done." }])
  const wires: string[][] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        wires.push((request.tools ?? []).map((t) => t.name))
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
      },
    }),
  )
  await Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "What is the weather in Paris?",
        taskType: "simple",
        memoryContext: "",
        availableTools: available.map((t) => t.name),
        availableToolSchemas: available,
        allToolSchemas: catalog,
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, mockToolServiceLayer({})))),
    ),
  )
  return wires[0] ?? []
}

// The default strategy threads its task into discover-tools: after a reactive
// run, the discover-tools handler it registered answers a one-capability query
// with the task's other needed tool appended (kernel scorer, spike 2026-11-06).
describe("discover-tools task appendix (reactive path)", () => {
  test("a query naming one capability also lists the task's other tool", async () => {
    const PRICE = schema("crypto-price", "Get current crypto prices for a coin symbol")
    const SEARCH = schema("web-search", "Search the web for research on market trends")
    const program = Effect.gen(function* () {
      yield* executeReactive({
        taskDescription: "Get the BTC crypto price and search the web for research on market trends",
        taskType: "simple",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        allToolSchemas: [PRICE, SEARCH, CALENDAR],
        config: defaultReasoningConfig,
      })
      const toolService = yield* ToolService
      const out = yield* toolService.execute({
        toolName: "discover-tools",
        arguments: { query: "crypto prices" },
        agentId: "test-agent",
        sessionId: "test-session",
      })
      return String(out.result)
    })
    const text = await Effect.runPromise(
      provideTestEnvelope(
        program.pipe(Effect.provide(Layer.merge(Layer.succeed(LLMService, TestLLMService([{ text: "FINAL ANSWER: done." }])), createToolsLayer()))),
      ),
    )
    expect(text).toContain("- crypto-price(")
    expect(text).toContain("- web-search(")
    expect(text).not.toContain("calendar-events")
  }, 20000)
})

describe("turn-1 wire (runner)", () => {
  test("a custom-tool run whose offered set was pruned to nothing still offers a domain tool", async () => {
    const wire = await turnOneWire([], [WEATHER, CALENDAR])
    expect(wire).toContain("weather-lookup")
  })

  test("every permitted tool already offered: no discover-tools on the wire", async () => {
    const wire = await turnOneWire([WEATHER], [WEATHER])
    expect(wire).toContain("weather-lookup")
    expect(wire).not.toContain("discover-tools")
  })

  test("a permitted tool still hidden: discover-tools is on the wire", async () => {
    const wire = await turnOneWire([WEATHER], [WEATHER, CALENDAR])
    expect(wire).toContain("weather-lookup")
    expect(wire).toContain("discover-tools")
  })
})
