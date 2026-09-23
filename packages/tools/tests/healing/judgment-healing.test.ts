import { describe, it, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { JudgmentService } from "@reactive-agents/judgment"
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment"
import { runJudgmentHealing } from "../../src/healing/judgment-healing.js"
import type { ToolCallSpec } from "../../src/tool-calling/types.js"

/**
 * Task 12: judgment-backed healing escalation (ADD, lowest leverage).
 * Pins: exact match never calls ask(); a distance-miss heals when the
 * judgment answer is high-confidence; a low-confidence answer and a
 * backend failure both degrade to an unchanged passthrough.
 */

const registeredTools = [
  {
    name: "file-read",
    description: "Read a file from disk",
    parameters: [{ name: "path", type: "string", description: "path to read", required: true }],
  },
  {
    name: "code-execute",
    description: "Run a snippet of code",
    parameters: [{ name: "code", type: "string", description: "code to run", required: true }],
  },
]

const fileToolNames = new Set(["file-read", "file-write", "code-execute"])
const workingDir = "/workspace"

let askCallCount = 0

const countingLayer = (
  makeAnswers: (input: { readonly questions: Record<string, unknown> }) => Record<string, unknown>,
) =>
  Layer.succeed(JudgmentService, {
    ask: (input) => {
      askCallCount++
      return Effect.succeed(makeAnswers(input) as unknown as JudgmentAnswers<typeof input.questions>)
    },
  })

const FailingJudgmentLayer = Layer.succeed(JudgmentService, {
  ask: () => Effect.fail({ _tag: "JudgmentTimeout", message: "too slow", timeoutMs: 3000 } as unknown as JudgmentError),
})

function runWith(layer: Layer.Layer<JudgmentService>, call: ToolCallSpec) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const judgment = yield* JudgmentService
      return yield* runJudgmentHealing(judgment, call, registeredTools, fileToolNames, workingDir, {}, {})
    }).pipe(Effect.provide(layer)),
  )
}

describe("runJudgmentHealing (Task 12)", () => {
  it("exact match never calls JudgmentService.ask()", async () => {
    askCallCount = 0
    const layer = countingLayer(() => ({}))
    const call: ToolCallSpec = { id: "1", name: "file-read", arguments: { path: "/workspace/foo.ts" } }
    const result = await runWith(layer, call)

    expect(askCallCount).toBe(0)
    expect(result.succeeded).toBe(true)
    expect(result.call.name).toBe("file-read")
  })

  it("distance-miss heals via a high-confidence Choice + Noul answer", async () => {
    askCallCount = 0
    const layer = countingLayer(() => ({
      tool_name: {
        kind: "choice",
        value: "file-read",
        probabilities: { "file-read": 0.95, "code-execute": 0.05 },
        confidence: 0.95,
        calibrated: true,
      },
      "arg_present::path": { kind: "noul", probability: 0.9 },
    }))
    // "flie-reed" is far enough from every registered name that healToolName's
    // edit-distance stage (≤ 2) misses, forcing escalation.
    const call: ToolCallSpec = { id: "1", name: "flie-reed-totally-different", arguments: { filepath: "/workspace/foo.ts" } }
    const result = await runWith(layer, call)

    expect(askCallCount).toBe(1)
    expect(result.succeeded).toBe(true)
    expect(result.call.name).toBe("file-read")
    expect(result.actions.some((a) => a.stage === "judgment" && a.to === "file-read")).toBe(true)
  })

  it("low-confidence answer passes the call through unchanged", async () => {
    askCallCount = 0
    const layer = countingLayer(() => ({
      tool_name: {
        kind: "choice",
        value: "file-read",
        probabilities: { "file-read": 0.4, "code-execute": 0.3 },
        confidence: 0.4,
        calibrated: true,
      },
      "arg_present::path": { kind: "noul", probability: 0.9 },
    }))
    const call: ToolCallSpec = { id: "1", name: "flie-reed-totally-different", arguments: { filepath: "/workspace/foo.ts" } }
    const result = await runWith(layer, call)

    expect(askCallCount).toBe(1)
    expect(result.succeeded).toBe(false)
    expect(result.call).toEqual(call)
  })

  it("backend failure degrades to an unchanged passthrough", async () => {
    const call: ToolCallSpec = { id: "1", name: "flie-reed-totally-different", arguments: { filepath: "/workspace/foo.ts" } }
    const result = await runWith(FailingJudgmentLayer, call)

    expect(result.succeeded).toBe(false)
    expect(result.call).toEqual(call)
  })

  it("a resolved tool name with no matching registered schema degrades to an unchanged passthrough (never trusts unverified backend output)", async () => {
    askCallCount = 0
    const layer = countingLayer(() => ({
      tool_name: {
        kind: "choice",
        value: "not-a-real-tool",
        probabilities: { "not-a-real-tool": 0.95 },
        confidence: 0.95,
        calibrated: true,
      },
      "arg_present::path": { kind: "noul", probability: 0.9 },
    }))
    const call: ToolCallSpec = { id: "1", name: "flie-reed-totally-different", arguments: { filepath: "/workspace/foo.ts" } }
    const result = await runWith(layer, call)

    expect(askCallCount).toBe(1)
    expect(result.succeeded).toBe(false)
    expect(result.call).toEqual(call)
  })

  it("runs healParamNames against the judgment-resolved schema, so an alias'd param name still heals", async () => {
    askCallCount = 0
    // "code-execute" takes a required "code" param; the caller's leftover arg
    // key is its exact alias — must be renamed by healParamNames, the stage
    // Task 12's escalation was missing before this fix.
    const layer = countingLayer(() => ({
      tool_name: {
        kind: "choice",
        value: "code-execute",
        probabilities: { "code-execute": 0.95, "file-read": 0.05 },
        confidence: 0.95,
        calibrated: true,
      },
      "arg_present::code": { kind: "noul", probability: 0.1 }, // low — the alias map heals it, not the judgment remap
    }))
    const call: ToolCallSpec = { id: "1", name: "totally-unknown-tool-xyz", arguments: { script: "print(1)" } }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const judgment = yield* JudgmentService
        return yield* runJudgmentHealing(judgment, call, registeredTools, fileToolNames, workingDir, {}, {
          "code-execute": { script: "code" },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.succeeded).toBe(true)
    expect(result.call.arguments).toEqual({ code: "print(1)" })
  })
})
