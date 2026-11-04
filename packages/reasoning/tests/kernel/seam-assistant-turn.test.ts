import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type StreamEvent } from "@reactive-agents/llm-provider"
import { NativeFCStrategy } from "@reactive-agents/tools"
import { EventBus, EventBusLive } from "@reactive-agents/core"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js"
import { makeKernelContext, makeKernelState } from "../../src/testing/kernel-fixtures.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import { assembleOutput } from "../../src/kernel/loop/output-assembly.js"
import { compileRunContract } from "../../src/kernel/contract/run-contract.js"
import { consumeThinkStream } from "../../src/kernel/capabilities/reason/consume-think-stream.js"
import {
  deliverableTextOf,
  resolveAssistantTurn,
  type ResolveAssistantTurnParams,
} from "../../src/kernel/capabilities/reason/assistant-turn.js"
import { UNRESOLVED_STEP_META } from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"
import { unresolvedThoughtSet } from "../../src/kernel/capabilities/reflect/unresolved-steps.js"
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js"
import type { ReasoningStep } from "../../src/types/index.js"

// Canonical tool-call extraction P1 seam pins (spec 2026-11-03, Verification
// a/b/e + D7d). Turn texts are the REAL cogito:8b H3 required-tools run0 replies
// (trace 01M6HVWT4P8VPVTHH0CY0XW0BD, seq1164/1177/1201/1250).

const CSV = "/w/readings.csv"
const ITER0_PYTHON =
  "Let me help you with this task. I'll read the CSV file, compute the mean of the temperature column, and write the result to a file.\n\n" +
  "Let me execute the code to get the mean:\n\n```python\nimport pandas as pd\n\ndf = pd.read_csv('readings.csv')\nmean_temp = df['temp'].mean()\nrounded_mean = round(mean_temp, 2)\n```\n\n" +
  "The mean temperature value has been calculated and written to mean.txt in your working directory."
const ITER1_PRINTED_CALL =
  "Let me help you with this task. First, I need to read the readings.csv file to compute the mean of the temp column.\n\n" +
  "I'll use the `file-read` tool to read the readings.csv file. Here's the call:\n\n" +
  "```javascript\nfile-read({\n  path: \"" + CSV + "\",\n  encoding: \"utf-8\"\n})\n```\n\n" +
  "Once I get the data from the file, I can compute the mean of the temp column and write it to mean.txt. Would you like me to proceed with the file reading?"
const ITER2_NARRATION =
  "I understand the task now. Here's the code to do that:\n\n```python\nimport pandas as pd\nmean_temp = pd.read_csv('readings.csv')['temp'].mean()\n```\n\n" +
  "Let me execute this code using the file-read tool:\n\n"
const FINAL = "The mean temperature from the readings.csv file is 20.48 degrees."

const FILE_READ: ToolSchema = {
  name: "file-read",
  description: "Read a file",
  parameters: [
    { name: "path", type: "string", description: "path", required: true },
    { name: "encoding", type: "string", description: "encoding", required: false },
  ],
}

/** Faithful to run0: the corrupted printed-call read fails, the native read returns the CSV, the write lands. */
const toolLayer = mockToolServiceLayer({
  execute: (req) => {
    const path = typeof req.args === "object" && req.args !== null && "path" in req.args ? String(req.args.path) : ""
    if (req.toolName === "file-write") return Effect.succeed({ success: true, result: `✓ Written to ${path}` })
    return path.includes("{")
      ? Effect.succeed({ success: false, result: `File read failed: ENOENT: no such file or directory, open '${path}'` })
      : Effect.succeed({ success: true, result: "hour,temp\n0,18.5\n1,21.2" })
  },
  getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
})

const FILE_WRITE: ToolSchema = {
  name: "file-write",
  description: "Write a file",
  parameters: [
    { name: "path", type: "string", description: "path", required: true },
    { name: "content", type: "string", description: "content", required: true },
  ],
}

/**
 * Replay a cogito turn script through the real kernel (resolver auto-wired by
 * the runner). `full` = the faithful run0 shape (file-write still owed after the
 * reads, so the model's clean final turn is reached); otherwise file-read is the
 * only required tool and the run exits through harness synthesis right after
 * the reads (the exact-value run2 seq1383 class).
 */
const replayRun0 = (full = true) => {
  const inner = TestLLMService([
    { text: ITER0_PYTHON },
    { text: ITER1_PRINTED_CALL },
    { toolCall: { name: "file-read", args: { path: CSV } }, text: ITER2_NARRATION },
    ...(full ? [{ toolCall: { name: "file-write", args: { path: "./mean.txt", content: "20.48" } } }] : []),
    { text: FINAL },
  ])
  // Instrument fidelity: the scripted provider bills ~len/4 tokens per call, so
  // the low-delta guard (local/mid threshold 300/500) ends the replay before the
  // final turn. Real run0 billed 688-1217 tokens per think; `full` restores that
  // scale. The un-scaled replay keeps the early low-delta exit on purpose: it
  // reproduces the harness-synthesis delivery class (exact-value run2 seq1383).
  const pad = full ? 900 : 0
  const llm = LLMService.of({
    ...inner,
    stream: (req) =>
      inner.stream(req).pipe(
        Effect.map((s) =>
          Stream.map(s, (e): StreamEvent =>
            e.type === "usage" ? { ...e, usage: { ...e.usage, inputTokens: e.usage.inputTokens + pad, totalTokens: e.usage.totalTokens + pad } } : e,
          ),
        ),
      ),
  })
  const tools = full ? ["file-read", "file-write"] : ["file-read"]
  const guards: { guard: string; outcome: string; reason: string; metadata?: Record<string, unknown> }[] = []
  return Effect.runPromise(
    provideTestEnvelope(
      Effect.gen(function* () {
        const eb = yield* EventBus
        yield* eb.on("GuardFiredEmitted", (e) => Effect.sync(() => { guards.push(e) }))
        const result = yield* executeReactive({
        taskDescription: `${CSV} has columns hour,temp. Compute the mean of the temp column rounded to 2 decimal places` +
          (full ? " and write only that number to mean.txt." : "."),
        taskType: "simple",
        memoryContext: "",
        availableTools: tools,
        requiredTools: tools,
        availableToolSchemas: full ? [FILE_READ, FILE_WRITE] : [FILE_READ],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 8 },
          },
        },
        })
        return { result, guards }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(LLMService, llm), toolLayer, EventBusLive),
        ),
      ),
    ),
  )
}

const boundary = (thought: string, nativeCalls: ResolveAssistantTurnParams["nativeCalls"] = []) =>
  Effect.runPromise(
    resolveAssistantTurn({
      resolver: new NativeFCStrategy(),
      nativeCalls,
      content: thought,
      stopReason: nativeCalls.length > 0 ? "tool_use" : "end_turn",
      surface: [FILE_READ],
      thought,
    }),
  )

/** A thought step born the way normalize-think-response creates it. */
const bornStep = async (thought: string): Promise<ReasoningStep> =>
  makeStep("thought", thought, { assistantTurn: (await boundary(thought)).meta })

const CODE_CONTRACT = compileRunContract("Write the function.", {
  taskContract: {
    prompt: "Write the function.",
    tools: [],
    success: { type: "regex", pattern: "function" },
    outputShape: { mustInclude: ["```"] },
  },
})

describe("seam-assistant-turn: (a) the step is born annotated", () => {
  test("printed text call turn carries assistantTurn with the consumed span", async () => {
    const { result: r, guards } = await replayRun0()
    const steps = (r.steps ?? []) as readonly ReasoningStep[]
    // D5: the boundary reports the extraction through the guard-fired path.
    expect(guards.find((g) => g.guard === "tool_call_extracted" && g.metadata?.source === "text")?.metadata).toEqual({
      source: "text", dialect: "pseudo-code", tier: "pseudo", disposition: "mixed", callCount: 1,
    })
    const printed = steps.find((s) => s.type === "thought" && s.content.includes("file-read({"))
    const turn = printed?.metadata?.assistantTurn
    expect(turn?.source).toBe("text")
    expect(turn?.dialect).toBe("pseudo-code")
    expect(turn?.disposition).toBe("mixed")
    expect(turn?.consumedSpans.length).toBe(1)
    expect(turn?.deliverableText).not.toContain("file-read(")
    expect(turn?.deliverableText).toContain("Once I get the data")
    // step.content stays raw (steps are the system-observation record).
    expect(printed?.content).toContain("file-read({")
  }, 20000)
})

describe("seam-assistant-turn: (b) full run0 shape delivers the clean final sentence", () => {
  test("no code block, no printed call in the output", async () => {
    const { result: r, guards } = await replayRun0()
    const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
    expect(guards.some((g) => g.guard === "terminal_decision" && g.reason === "end_turn")).toBe(true)
    expect(out).toBe(FINAL)
  }, 20000)

  test("harness-synthesis exit right after the reads never delivers the printed call", async () => {
    const { result: r, guards } = await replayRun0(false)
    expect(guards.some((g) => g.guard === "terminal_decision" && g.reason === "harness_synthesis")).toBe(true)
    const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output)
    expect(out).not.toContain("file-read(")
    expect(out).not.toContain("```")
  }, 20000)

  test("code contract: a consumed-call block is never prepended (deliverableTextOf)", async () => {
    const steps = [await bornStep(ITER1_PRINTED_CALL)]
    const out = assembleOutput({ steps, finalAnswer: FINAL, terminatedBy: "end_turn", contract: CODE_CONTRACT })
    expect(out.text).toBe(FINAL)
  })
})

describe("seam-assistant-turn: D7d — an unconsumed code answer stays deliverable", () => {
  test("code contract + earlier prose code block -> block is prepended", async () => {
    const steps = [await bornStep("Here is the solution:\n```js\nfunction mean(xs) { return xs.reduce((a, b) => a + b) / xs.length }\n```")]
    const out = assembleOutput({ steps, finalAnswer: "Done.", terminatedBy: "end_turn", contract: CODE_CONTRACT })
    expect(out.text).toContain("function mean(xs)")
    expect(out.text).toContain("Done.")
  })

  test("mixed turn: the consumed call block goes, the unrelated code block stays", async () => {
    const thought = `${ITER1_PRINTED_CALL}\n\nMeanwhile, the helper:\n\`\`\`js\nconst avg = (xs) => xs.length\n\`\`\``
    const step = await bornStep(thought)
    expect(deliverableTextOf(step)).not.toContain("file-read(")
    expect(deliverableTextOf(step)).toContain("const avg = (xs) => xs.length")
  })

  test("a prose code answer with no tool call is untouched", async () => {
    const text = "```python\nprint(sum([1, 2, 3]))\n```"
    const step = await bornStep(text)
    expect(step.metadata?.assistantTurn?.disposition).toBe("prose")
    expect(deliverableTextOf(step)).toBe(text)
  })
})

describe("seam-assistant-turn: disposition decides the unresolved twin", () => {
  const RAW = '{"name":"nope","parameters":{"q":"x"}}'
  const tagged = makeStep("thought", `${RAW}\n\nTool call used unavailable name(s): nope.`, UNRESOLVED_STEP_META)
  test("an `unresolved` born step is the twin even when its content is not the tagged prefix", async () => {
    const born = makeStep("thought", `<think>x</think>${RAW}`, { assistantTurn: (await boundary(RAW)).meta })
    expect(born.metadata?.assistantTurn?.disposition).toBe("unresolved")
    expect(unresolvedThoughtSet([born, tagged]).has(born)).toBe(true)
  })
  test("an annotated prose step is never a twin, even when it is the tagged prefix", async () => {
    // An empty reply is a content prefix of every tagged step (legacy match says twin).
    const prose = await bornStep("")
    expect(prose.metadata?.assistantTurn?.disposition).toBe("prose")
    expect(unresolvedThoughtSet([prose, tagged]).has(prose)).toBe(false)
  })
})

describe("seam-assistant-turn: (e) stream / complete parity", () => {
  const consume = (events: readonly StreamEvent[]) =>
    Effect.runPromise(
      consumeThinkStream({
        state: makeKernelState(),
        llmStreamEffect: Effect.succeed(Stream.fromIterable(events)),
        context: makeKernelContext(),
      }),
    )
  const turnOf = async (events: readonly StreamEvent[]) => {
    const rec = await consume(events)
    expect(rec._tag).toBe("consumed")
    const consumed = rec._tag === "consumed" ? rec : undefined
    return Effect.runPromise(
      resolveAssistantTurn({
        resolver: new NativeFCStrategy(),
        nativeCalls: consumed?.accumulatedToolCalls ?? [],
        content: consumed?.accumulatedContent ?? "",
        stopReason: consumed?.accumulatedStopReason ?? "",
        surface: [FILE_READ],
        thought: consumed?.accumulatedContent ?? "",
      }),
    )
  }

  test("text: deltas vs one content_complete give an identical AssistantTurn", async () => {
    const half = Math.floor(ITER1_PRINTED_CALL.length / 2)
    const streamed = await turnOf([
      { type: "text_delta", text: ITER1_PRINTED_CALL.slice(0, half) },
      { type: "text_delta", text: ITER1_PRINTED_CALL.slice(half) },
    ])
    const completed = await turnOf([{ type: "content_complete", content: ITER1_PRINTED_CALL }])
    expect(streamed).toEqual(completed)
    expect(streamed.meta.disposition).toBe("mixed")
  })

  test("native: delta-built call vs complete content + call give an identical AssistantTurn", async () => {
    const call: readonly StreamEvent[] = [
      { type: "tool_use_start", id: "c1", name: "file-read" },
      { type: "tool_use_delta", input: `{"path":"${CSV}"}` },
    ]
    const streamed = await turnOf([{ type: "text_delta", text: ITER2_NARRATION }, ...call])
    const completed = await turnOf([...call, { type: "content_complete", content: ITER2_NARRATION }])
    expect(streamed).toEqual(completed)
    expect(streamed.meta.source).toBe("native")
    expect(streamed.meta.callIds).toEqual(["c1"])
  })
})
