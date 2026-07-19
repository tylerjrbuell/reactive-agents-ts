import { randomUUID } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
    LLMService,
    TestLLMServiceLayer,
    type CompletionRequest,
    type CompletionResponse,
} from "@reactive-agents/llm-provider"
import { ToolService, type ToolInput } from "@reactive-agents/tools"
import { TraceRecorderService, TraceRecorderServiceLive, type TraceEvent } from "@reactive-agents/trace"
import { buildLLMTable } from "./llm-table.js"
import { makeReplayController } from "./replay-controller.js"
import { makeReplayLLMLayer } from "./replay-llm-layer.js"
import { makeReplayToolLayer } from "./replay-tool-layer.js"
import { replay } from "./replay.js"
import { stableStringify } from "./stable-stringify.js"
import { buildToolTable, computeArgsHash } from "./tool-table.js"
import type { AgentRunOutcome } from "./snapshot.js"
import type { RecordedRun } from "./types.js"

const TASK = "Use the seeded-number tool and report its result."
const SYSTEM_PROMPT = "Use the supplied tool exactly once, then report the result."
const SEED = 23
const SEEDED_VALUE = seededValue(SEED)
const FINAL_OUTPUT = `The seeded value is ${SEEDED_VALUE}.`

interface SemanticStep {
    readonly kind: "llm" | "tool"
    readonly input: unknown
    readonly output: unknown
}

interface CapturedTask {
    readonly runId: string
    readonly steps: readonly SemanticStep[]
    readonly events: readonly TraceEvent[]
    readonly outcome: AgentRunOutcome
}

/**
 * The replay contract intentionally compares semantic steps, not invocation
 * envelopes. Timestamps, UUID-shaped run IDs, and wall-clock durations vary
 * across runs, so they remain in the trace while this serializer excludes
 * them. Object keys are recursively sorted by `stableStringify`; replay
 * tables use Maps for lookup only, while semantic step order is captured from
 * actual execution. This fixture admits only JSON-like values (no unordered
 * Set values).
 */
function canonicalStepBytes(steps: readonly SemanticStep[]): string {
    return stableStringify(steps)
}

function seededValue(seed: number): number {
    const state = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return Number((state / 2 ** 32).toFixed(6))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstDifferencePath(left: unknown, right: unknown, path = "$"): string | undefined {
    if (Object.is(left, right)) return undefined

    if (Array.isArray(left) && Array.isArray(right)) {
        const length = Math.max(left.length, right.length)
        for (let index = 0; index < length; index++) {
            const difference = firstDifferencePath(left[index], right[index], `${path}[${index}]`)
            if (difference) return difference
        }
        return undefined
    }

    if (isRecord(left) && isRecord(right)) {
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
        for (const key of keys) {
            const keyPath = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
                ? `${path}.${key}`
                : `${path}[${JSON.stringify(key)}]`
            const difference = firstDifferencePath(left[key], right[key], keyPath)
            if (difference) return difference
        }
        return undefined
    }

    return path
}

function assertSemanticReplay(recorded: readonly SemanticStep[], replayed: readonly SemanticStep[]): void {
    const difference = firstDifferencePath(recorded, replayed)
    if (difference) throw new Error(`Replay diverged at ${difference}`)
}

function projectResponse(response: CompletionResponse): Record<string, unknown> {
    return {
        content: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        model: response.model,
        toolCalls: response.toolCalls?.map((call) => ({ name: call.name, input: call.input })),
    }
}

function exchangeEvent(
    runId: string,
    seq: number,
    request: CompletionRequest,
    response: CompletionResponse,
): Extract<TraceEvent, { readonly kind: "llm-exchange" }> {
    return {
        kind: "llm-exchange",
        runId,
        timestamp: Date.now(),
        iter: 0,
        seq,
        provider: "test",
        model: "test-model",
        requestKind: "complete",
        systemPrompt: request.systemPrompt,
        messages: request.messages.map((message) => ({
            role: message.role,
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        })),
        toolSchemaNames: ["seeded-number"],
        temperature: request.temperature,
        response: {
            content: response.content,
            toolCalls: response.toolCalls?.map((call) => ({ name: call.name, arguments: call.input })),
            stopReason: response.stopReason,
            tokensIn: response.usage.inputTokens,
            tokensOut: response.usage.outputTokens,
        },
    }
}

function makeSeededToolLayer() {
    const unavailable = (method: string): Effect.Effect<never, never> =>
        Effect.die(new Error(`e2e fixture does not use ToolService.${method}`))

    return Layer.succeed(
        ToolService,
        ToolService.of({
            execute: ((input: ToolInput) =>
                Effect.gen(function* () {
                    if (input.toolName !== "seeded-number") {
                        return yield* Effect.die(new Error(`unexpected tool: ${input.toolName}`))
                    }
                    const seed = input.arguments.seed
                    if (typeof seed !== "number") {
                        return yield* Effect.die(new Error("seeded-number requires a numeric seed"))
                    }
                    return {
                        toolName: input.toolName,
                        success: true as const,
                        result: { seed, value: seededValue(seed) },
                        executionTimeMs: 0,
                    }
                })) as never,
            register: (() => unavailable("register")) as never,
            unregisterTool: (() => Effect.void) as never,
            connectMCPServer: (() => unavailable("connectMCPServer")) as never,
            disconnectMCPServer: (() => unavailable("disconnectMCPServer")) as never,
            listTools: (() => Effect.succeed([] as never)) as never,
            getTool: (() => unavailable("getTool")) as never,
            toFunctionCallingFormat: (() => Effect.succeed([] as never)) as never,
            listMCPServers: (() => Effect.succeed([] as never)) as never,
        }),
    )
}

function runSeededTask(runId: string, task: string): Effect.Effect<CapturedTask, unknown, LLMService | ToolService | TraceRecorderService> {
    return Effect.gen(function* () {
        const recorder = yield* TraceRecorderService
        const llm = yield* LLMService
        const tools = yield* ToolService
        const startedAt = Date.now()
        const steps: SemanticStep[] = []

        yield* recorder.emit({
            kind: "run-started",
            runId,
            timestamp: startedAt,
            iter: -1,
            seq: 0,
            task,
            model: "test-model",
            provider: "test",
            seed: SEED,
            config: { temperature: 0, fixture: "seeded-number" },
        })

        const firstRequest: CompletionRequest = {
            model: "test-model",
            temperature: 0,
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: "user", content: task }],
        }
        const firstResponse = yield* llm.complete(firstRequest)
        yield* recorder.emit(exchangeEvent(runId, 1, firstRequest, firstResponse))
        steps.push({ kind: "llm", input: firstRequest, output: projectResponse(firstResponse) })

        const call = firstResponse.toolCalls?.[0]
        if (!call || !isRecord(call.input)) {
            return yield* Effect.die(new Error("seeded provider did not return the expected tool call"))
        }
        const toolInput: ToolInput = {
            toolName: call.name,
            arguments: call.input,
            agentId: "replay-e2e-agent",
            sessionId: runId,
        }
        yield* recorder.emit({
            kind: "tool-call-start",
            runId,
            timestamp: Date.now(),
            iter: 0,
            seq: 2,
            toolName: toolInput.toolName,
            args: toolInput.arguments,
        })
        const toolOutput = yield* tools.execute(toolInput)
        yield* recorder.emit({
            kind: "tool-call-end",
            runId,
            timestamp: Date.now(),
            iter: 0,
            seq: 3,
            toolName: toolInput.toolName,
            args: toolInput.arguments,
            result: toolOutput.result,
            ok: toolOutput.success,
            durationMs: toolOutput.executionTimeMs,
        })
        steps.push({
            kind: "tool",
            input: { toolName: toolInput.toolName, arguments: toolInput.arguments },
            output: toolOutput.result,
        })

        const secondRequest: CompletionRequest = {
            model: "test-model",
            temperature: 0,
            systemPrompt: SYSTEM_PROMPT,
            messages: [
                { role: "user", content: task },
                { role: "assistant", content: JSON.stringify({ toolName: toolInput.toolName, arguments: toolInput.arguments }) },
                {
                    role: "tool",
                    toolCallId: "seeded-number-0",
                    toolName: toolInput.toolName,
                    content: JSON.stringify(toolOutput.result),
                },
            ],
        }
        const secondResponse = yield* llm.complete(secondRequest)
        yield* recorder.emit(exchangeEvent(runId, 4, secondRequest, secondResponse))
        steps.push({ kind: "llm", input: secondRequest, output: projectResponse(secondResponse) })

        const totalTokens = firstResponse.usage.totalTokens + secondResponse.usage.totalTokens
        const durationMs = Date.now() - startedAt
        yield* recorder.emit({
            kind: "run-completed",
            runId,
            timestamp: Date.now(),
            iter: 0,
            seq: 5,
            status: "success",
            output: secondResponse.content,
            totalTokens,
            totalCostUsd: 0,
            durationMs,
        })

        const events = yield* recorder.snapshot(runId)
        return {
            runId,
            steps,
            events,
            outcome: {
                output: secondResponse.content,
                totalTokens,
                totalCostUsd: 0,
                durationMs,
                iterations: 0,
                toolCalls: [{ toolName: toolInput.toolName, argsHash: computeArgsHash(toolInput.arguments), ok: toolOutput.success }],
            },
        }
    })
}

function toRecordedRun(captured: CapturedTask): RecordedRun {
    const started = captured.events.find(
        (event): event is Extract<TraceEvent, { readonly kind: "run-started" }> => event.kind === "run-started",
    )
    if (!started) throw new Error("seeded task did not record run-started")

    return {
        runId: captured.runId,
        task: started.task,
        model: started.model,
        provider: started.provider,
        config: started.config,
        trace: { runId: captured.runId, events: captured.events },
        toolTable: buildToolTable(captured.events),
        llmTable: buildLLMTable(captured.events),
    }
}

function mutateRecordedToolResult(captured: CapturedTask): RecordedRun {
    const changedResult = { seed: SEED, value: SEEDED_VALUE + 1 }
    const events = captured.events.map((event) => {
        if (event.kind === "tool-call-end") {
            return { ...event, result: changedResult }
        }
        if (event.kind === "llm-exchange" && event.seq === 4) {
            return {
                ...event,
                messages: event.messages.map((message) =>
                    message.role === "tool"
                        ? { ...message, content: JSON.stringify(changedResult) }
                        : message,
                ),
            }
        }
        return event
    })
    return toRecordedRun({ ...captured, events })
}

async function replayRecordedRun(recordedRun: RecordedRun): Promise<{
    readonly result: Awaited<ReturnType<typeof replay>>
    readonly steps: readonly SemanticStep[]
}> {
    let replayedSteps: readonly SemanticStep[] = []
    const result = await replay(recordedRun, async () => {
        const replayLayers = Layer.mergeAll(
            makeReplayLLMLayer(recordedRun.llmTable),
            makeReplayToolLayer(makeReplayController(recordedRun.toolTable)),
            TraceRecorderServiceLive({ dir: null }),
        )
        return {
            run: async (task: string) => {
                const replayed = await Effect.runPromise(
                    runSeededTask(`replay-${randomUUID()}`, task).pipe(Effect.provide(replayLayers)),
                )
                replayedSteps = replayed.steps
                return replayed.outcome
            },
            dispose: async () => {},
        }
    })
    return { result, steps: replayedSteps }
}

describe("replay end-to-end determinism", () => {
    test("records and replays a seeded tool task byte-for-byte", async () => {
        const recordingLayers = Layer.mergeAll(
            TestLLMServiceLayer([
                { toolCall: { name: "seeded-number", args: { seed: SEED } } },
                { text: FINAL_OUTPUT },
            ]),
            makeSeededToolLayer(),
            TraceRecorderServiceLive({ dir: null }),
        )
        const captured = await Effect.runPromise(
            runSeededTask(`record-${randomUUID()}`, TASK).pipe(Effect.provide(recordingLayers)),
        )
        const recordedRun = toRecordedRun(captured)
        const replayed = await replayRecordedRun(recordedRun)

        expect(replayed.result.diff.identical).toBe(true)
        expect(canonicalStepBytes(replayed.steps)).toBe(canonicalStepBytes(captured.steps))
        expect(() => assertSemanticReplay(captured.steps, replayed.steps)).not.toThrow()

        const corruptedReplay = await replayRecordedRun(mutateRecordedToolResult(captured))

        expect(canonicalStepBytes(corruptedReplay.steps)).not.toBe(canonicalStepBytes(captured.steps))
        expect(firstDifferencePath(captured.steps, corruptedReplay.steps)).toBe("$[1].output.value")
        expect(() => assertSemanticReplay(captured.steps, corruptedReplay.steps)).toThrow(
            "Replay diverged at $[1].output.value",
        )
    })
})
