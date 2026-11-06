// Run: bun test packages/reasoning/tests/kernel/reason/strict-discover.test.ts --timeout 15000
//
// Explicit `.withTools({ disclosure: "discover" })` means load on demand: turn 1
// offers only meta tools (incl. discover-tools) plus required tools; a permitted
// domain tool becomes visible and callable only after discover-tools surfaced it.
// allowedTools / builtin floor bound permission here, never visibility, and the
// never-zero floor adds no keyword picks. The kernel reads the explicit mode
// from `harness.disclosureMode`, which `fromDisclosureMode` sets and
// `resolveHarnessConfig` takes from the explicit config layer only, so a tier
// default of "discover" keeps today's surface.

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Stream } from "effect"
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider"
import { currentDiscoveredToolsStore } from "@reactive-agents/tools"
import { resolveToolSurface, type ToolSurfaceInputs } from "../../../src/kernel/capabilities/reason/tool-surface.js"
import type { ToolSchema } from "../../../src/kernel/capabilities/attend/tool-formatting.js"
import { fromDisclosureMode, resolveHarnessConfig } from "../../../src/harness-config.js"
import { executeReactive } from "../../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../../src/types/config.js"
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js"

const schema = (name: string, description = `${name} tool`): ToolSchema => ({ name, description, parameters: [] })
const names = (xs: readonly ToolSchema[]) => xs.map((t) => t.name)

const A = schema("weather-lookup", "Look up the current weather forecast for a city")
const B = schema("calendar-events", "List calendar events")
const C = schema("email-send", "Send an email")
const DISCOVER = schema("discover-tools", "List callable tools")
const FINAL = schema("final-answer")

const STRICT = resolveHarnessConfig(fromDisclosureMode("discover"))

const inputs = (over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs => ({
  augmented: [A, B, C, DISCOVER],
  finalAnswerSchema: FINAL,
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [],
  relevantTools: [],
  allowedTools: ["weather-lookup", "calendar-events", "email-send"],
  toolsUsed: [],
  discovered: [],
  gateBlockedTools: [],
  missingRequiredTools: [],
  pruneMinTools: 15,
  catalog: [A, B, C],
  taskText: "What is the weather in Paris?",
  floorTools: ["weather-lookup"],
  harness: STRICT,
  ...over,
})

describe("explicit discover (resolver seam)", () => {
  test("turn 1: only meta tools, allowedTools and keyword matches stay hidden", () => {
    const s = resolveToolSurface(inputs())
    expect(names(s.visible)).toEqual(["discover-tools"])
    expect(s.reasons.get("weather-lookup")).toContain("hidden")
  })

  test("a required tool is visible from turn 1", () => {
    const s = resolveToolSurface(inputs({ requiredTools: ["email-send"] }))
    expect(names(s.visible)).toEqual(["email-send", "discover-tools"])
  })

  test("a discovered tool becomes visible; the rest stay hidden", () => {
    const s = resolveToolSurface(inputs({ discovered: ["calendar-events"] }))
    expect(names(s.visible)).toEqual(["calendar-events", "discover-tools"])
  })

  test("only the explicit layer is strict: a tier-default discover keeps the floors", () => {
    expect(resolveHarnessConfig({}, fromDisclosureMode("discover")).disclosureMode).toBeUndefined()
    const s = resolveToolSurface(inputs({ harness: resolveHarnessConfig({}, fromDisclosureMode("discover")) }))
    expect(names(s.visible)).toContain("weather-lookup")
  })
})

// ─── The real runner ─────────────────────────────────────────────────────────

const runStrict = async (turns: TestTurn[], requiredTools?: readonly string[]) => {
  const inner = TestLLMService(turns)
  const wires: string[][] = []
  const executed: string[] = []
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
  // discover-tools surfaces calendar-events, as the real handler would.
  const tools = mockToolServiceLayer({
    execute: (req) =>
      Effect.gen(function* () {
        executed.push(req.toolName)
        if (req.toolName === "discover-tools") {
          const ref = yield* currentDiscoveredToolsStore
          yield* Ref.update(ref, (s) => new Set([...s, "calendar-events"]))
          return { success: true, result: "calendar-events: List calendar events (now callable)" }
        }
        return { success: true, result: "Meeting at 10am" }
      }),
  })
  await Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "What is the weather in Paris and my next meeting?",
        taskType: "simple",
        memoryContext: "",
        availableTools: [A, B, C].map((t) => t.name),
        availableToolSchemas: [A, B, C],
        allToolSchemas: [A, B, C],
        allowedTools: ["weather-lookup", "calendar-events", "email-send"],
        ...(requiredTools ? { requiredTools } : {}),
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, tools))),
      buildRunEnvelope({ harness: fromDisclosureMode("discover") }),
    ),
  )
  return { wires, executed }
}

describe("explicit discover (runner)", () => {
  test("turn 1 offers no domain tool; the discovered tool is offered next and runs", async () => {
    const { wires, executed } = await runStrict([
      { toolCall: { name: "discover-tools", args: { query: "calendar" } } },
      { toolCall: { name: "calendar-events", args: {} } },
      { text: "FINAL ANSWER: Meeting at 10am." },
    ])
    expect(wires[0]).not.toContain("weather-lookup")
    expect(wires[0]).not.toContain("calendar-events")
    expect(wires[0]).not.toContain("email-send")
    expect(wires[0]).toContain("discover-tools")
    expect(wires[1]).toContain("calendar-events")
    expect(wires[1]).not.toContain("email-send")
    expect(executed).toEqual(["discover-tools", "calendar-events"])
  })

  test("a required tool is on the turn-1 wire", async () => {
    const { wires } = await runStrict([{ text: "FINAL ANSWER: done." }], ["email-send"])
    expect(wires[0]).toContain("email-send")
    expect(wires[0]).not.toContain("weather-lookup")
  })
})
