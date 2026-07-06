import { describe, test, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMService } from "@reactive-agents/llm-provider"
import type { CompletionRequest } from "@reactive-agents/llm-provider"
import type { LLMExchangeEvent } from "@reactive-agents/trace"
import { buildLLMTable } from "../src/llm-table.js"
import { makeReplayLLMLayer } from "../src/replay-llm-layer.js"

const exchangeEvent: LLMExchangeEvent = {
    kind: "llm-exchange",
    runId: "r1",
    timestamp: 2,
    iter: 0,
    seq: 1,
    provider: "ollama",
    model: "qwen3:4b",
    requestKind: "stream",
    systemPrompt: "You are helpful.",
    messages: [{ role: "user", content: "compute 137*89" }],
    toolSchemaNames: ["calculator"],
    response: {
        content: "",
        toolCalls: [{ name: "calculator", arguments: { expression: "137*89" } }],
        stopReason: "tool_use",
        tokensIn: 10,
        tokensOut: 5,
    },
}

describe("replay LLM layer", () => {
    test("dispenses the recorded tool call for a matching request", async () => {
        const table = buildLLMTable([exchangeEvent])
        const program = Effect.gen(function* () {
            const llm = yield* LLMService
            const s = yield* llm.stream({
                systemPrompt: "You are helpful.",
                messages: [{ role: "user", content: "compute 137*89" }],
            } satisfies CompletionRequest)
            const events = yield* Stream.runCollect(s)
            return Array.from(events)
        }).pipe(Effect.provide(makeReplayLLMLayer(table)))
        const events = await Effect.runPromise(program)
        const start = events.find((e) => e.type === "tool_use_start")
        const deltas = events.filter((e) => e.type === "tool_use_delta")
        expect(start && start.type === "tool_use_start" ? start.name : undefined).toBe("calculator")
        const joined = deltas.map((d) => (d.type === "tool_use_delta" ? d.input : "")).join("")
        expect(JSON.parse(joined)).toEqual({ expression: "137*89" })
    }, 15000)

    test("strict mode dies on unrecorded request", async () => {
        const table = buildLLMTable([])
        const program = Effect.gen(function* () {
            const llm = yield* LLMService
            yield* llm.complete({ messages: [{ role: "user", content: "novel" }] } satisfies CompletionRequest)
        }).pipe(Effect.provide(makeReplayLLMLayer(table)))
        await expect(Effect.runPromise(program)).rejects.toThrow(/no recorded exchange/i)
    }, 15000)

    test("builds a non-empty table from a real captured-trace fixture shape", () => {
        // Guards the seam: field names here must match packages/trace/src/normalize.ts:198-217
        // (LLMExchangeEmitted -> kind:"llm-exchange" mapping) exactly, or the table silently
        // builds empty from real recorded traces.
        const realShapeEvent: LLMExchangeEvent = {
            kind: "llm-exchange",
            runId: "r2",
            timestamp: 100,
            iter: 1,
            seq: 4,
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            requestKind: "complete",
            systemPrompt: "You are a helpful assistant.",
            systemPromptTruncated: false,
            messages: [
                { role: "user", content: "What is 2+2?" },
                { role: "assistant", content: "" },
            ],
            toolSchemaNames: [],
            temperature: 0.7,
            maxTokens: 1024,
            response: {
                content: "4",
                stopReason: "end_turn",
                tokensIn: 12,
                tokensOut: 3,
                costUsd: 0.0001,
                durationMs: 250,
            },
        }
        const table = buildLLMTable([realShapeEvent])
        expect(table.size).toBe(1)
    })

    test("HITS when live messages carry ContentBlock[] content (record-side flattening parity)", async () => {
        // Record side flattens ContentBlock[] via messageContentToString
        // (llm-provider exchange-projection): text blocks verbatim, tool_use ->
        // "[tool_use:<name>]", tool_result -> "[tool_result]". The recorded
        // event carries the flattened strings; the live request carries the
        // raw blocks. From the 2nd LLM call onward every tool-using thread
        // looks like this — divergence here means replay dies on exactly the
        // workloads it exists for.
        const recorded: LLMExchangeEvent = {
            kind: "llm-exchange",
            runId: "r3",
            timestamp: 5,
            iter: 1,
            seq: 7,
            provider: "ollama",
            model: "qwen3:4b",
            requestKind: "stream",
            systemPrompt: "You are helpful.",
            messages: [
                { role: "user", content: "compute 137*89" },
                { role: "assistant", content: "I'll compute.[tool_use:calculator]" },
                { role: "tool", content: "12193" },
            ],
            toolSchemaNames: ["calculator"],
            response: { content: "137*89 = 12193", stopReason: "end_turn", tokensIn: 40, tokensOut: 8 },
        }
        const table = buildLLMTable([recorded])
        const program = Effect.gen(function* () {
            const llm = yield* LLMService
            return yield* llm.complete({
                systemPrompt: "You are helpful.",
                messages: [
                    { role: "user", content: "compute 137*89" },
                    {
                        role: "assistant",
                        content: [
                            { type: "text", text: "I'll compute." },
                            { type: "tool_use", id: "t1", name: "calculator", input: { expression: "137*89" } },
                        ],
                    },
                    { role: "tool", toolCallId: "t1", toolName: "calculator", content: "12193" },
                ],
            } satisfies CompletionRequest)
        }).pipe(Effect.provide(makeReplayLLMLayer(table)))
        const response = await Effect.runPromise(program)
        expect(response.content).toBe("137*89 = 12193")
        expect(response.stopReason).toBe("end_turn")
    }, 15000)

    test("HITS when the live systemPrompt exceeds the record-side truncation cap", async () => {
        // emitLLMExchange caps systemPrompt at EXCHANGE_SYSTEM_PROMPT_MAX (4000)
        // before the event enters the trace; the live request carries the full
        // prompt. exchangeKey applies the same cap on both sides, so a 5000-char
        // live prompt must hash to the same key as its 4000-char recording.
        const fullPrompt = "S".repeat(5000)
        const recorded: LLMExchangeEvent = {
            kind: "llm-exchange",
            runId: "r4",
            timestamp: 9,
            iter: 0,
            seq: 2,
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            requestKind: "complete",
            systemPrompt: fullPrompt.slice(0, 4000), // as recorded: truncated
            systemPromptTruncated: true,
            messages: [{ role: "user", content: "hello" }],
            toolSchemaNames: [],
            response: { content: "hi", stopReason: "end_turn", tokensIn: 1200, tokensOut: 2 },
        }
        const table = buildLLMTable([recorded])
        const program = Effect.gen(function* () {
            const llm = yield* LLMService
            return yield* llm.complete({
                systemPrompt: fullPrompt, // live: full length
                messages: [{ role: "user", content: "hello" }],
            } satisfies CompletionRequest)
        }).pipe(Effect.provide(makeReplayLLMLayer(table)))
        const response = await Effect.runPromise(program)
        expect(response.content).toBe("hi")
    }, 15000)
})
