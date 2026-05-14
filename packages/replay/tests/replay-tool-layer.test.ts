import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { ToolService } from "@reactive-agents/tools"
import { makeReplayToolLayer } from "../src/replay-tool-layer.js"
import { makeReplayController } from "../src/replay-controller.js"
import { computeArgsHash } from "../src/tool-table.js"
import type { RecordedToolResult } from "../src/types.js"

describe("ReplayToolLayer", () => {
    test("execute returns recorded result without calling live tool", async () => {
        const h = computeArgsHash({ q: "x" })
        const table = new Map<string, RecordedToolResult[]>([
            [`search::${h}`, [
                { toolName: "search", argsHash: h, args: { q: "x" }, result: "recorded-output", ok: true, durationMs: 0, iter: 0, seq: 0 },
            ]],
        ])
        const ctrl = makeReplayController(table)
        const layer = makeReplayToolLayer(ctrl, "strict")
        const program = Effect.gen(function* () {
            const ts = yield* ToolService
            return yield* ts.execute({
                toolName: "search",
                arguments: { q: "x" },
                agentId: "a",
                sessionId: "s",
            } as never)
        })
        const result = (await Effect.runPromise(Effect.provide(program, layer))) as { result: unknown; success: boolean }
        expect(result.success).toBe(true)
        expect(result.result).toBe("recorded-output")
    })

    test("strict mode dies on unrecorded tool call", async () => {
        const ctrl = makeReplayController(new Map())
        const layer = makeReplayToolLayer(ctrl, "strict")
        const program = Effect.gen(function* () {
            const ts = yield* ToolService
            return yield* ts.execute({ toolName: "unknown", arguments: {}, agentId: "a", sessionId: "s" } as never)
        })
        await expect(Effect.runPromise(Effect.provide(program, layer))).rejects.toThrow(/unrecorded/i)
    })

    test("lenient mode returns failure marker on unrecorded call", async () => {
        const ctrl = makeReplayController(new Map())
        const layer = makeReplayToolLayer(ctrl, "lenient")
        const program = Effect.gen(function* () {
            const ts = yield* ToolService
            return yield* ts.execute({ toolName: "unknown", arguments: {}, agentId: "a", sessionId: "s" } as never)
        })
        const r = (await Effect.runPromise(Effect.provide(program, layer))) as { success: boolean; error: string }
        expect(r.success).toBe(false)
        expect(r.error).toMatch(/no recording/i)
    })

    test("propagates recorded errors as failed tool output", async () => {
        const h = computeArgsHash({})
        const table = new Map<string, RecordedToolResult[]>([
            [`flaky::${h}`, [
                { toolName: "flaky", argsHash: h, args: {}, result: undefined, ok: false, error: "tool exploded", durationMs: 0, iter: 0, seq: 0 },
            ]],
        ])
        const ctrl = makeReplayController(table)
        const layer = makeReplayToolLayer(ctrl, "strict")
        const program = Effect.gen(function* () {
            const ts = yield* ToolService
            return yield* ts.execute({ toolName: "flaky", arguments: {}, agentId: "a", sessionId: "s" } as never)
        })
        const r = (await Effect.runPromise(Effect.provide(program, layer))) as { success: boolean; error: string }
        expect(r.success).toBe(false)
        expect(r.error).toBe("tool exploded")
    })
})
